"use strict";

import { ArrayUtils } from "./utils.ts";
import { geometry, Point } from "./tools.ts";
import { CONFIG } from "./config.ts";
import { Node, parseSelected, pointKey, nodeIsBefore, type NodeSelected } from "./node.ts";
import { Track } from "./track.ts";
import { Switch } from "./switch.ts";
import { Signal } from "./signal.ts";
import { Train } from "./train.ts";
import { RailwayCrossing } from "./railway_crossing.ts";

export interface NodeJSON {
   id: number;
   x: number;
   y: number;
   selected?: NodeSelected | Record<string, number>;
}

export interface EdgeJSON {
   id: number;
   a: number;
   b: number;
   bumperA?: boolean;
   bumperB?: boolean;
}

export class RailNetwork {
   #nodes = new Map<number, Node>();
   #tracks = new Map<number, Track>();
   #adj = new Map<number, Track[]>();
   #byPoint = new Map<string, Node>();
   #nextNodeId = 0;
   #nextTrackId = 0;

   getTrack(id: number): Track | undefined {
      return this.#tracks.get(id);
   }

   nodeAt(point: { x: number; y: number }): Node | undefined {
      return this.#byPoint.get(pointKey(point));
   }

   edgesAt(node: Node): Track[] {
      return this.#adj.get(node.id) ?? [];
   }

   degree(node: Node): number {
      return this.edgesAt(node).length;
   }

   clear(): void {
      this.#nodes.clear();
      this.#tracks.clear();
      this.#adj.clear();
      this.#byPoint.clear();
      this.#nextNodeId = 0;
      this.#nextTrackId = 0;
      Track.allTracks.length = 0;
      Switch.allSwitches.length = 0;
   }

   load(nodes: NodeJSON[], edges: EdgeJSON[]): void {
      this.clear();
      let maxNode = 0;
      let maxEdge = 0;
      for (const json of nodes) {
         const node = new Node(json.id, json.x, json.y, parseSelected(json.selected));
         this.#nodes.set(node.id, node);
         this.#byPoint.set(pointKey(node.location), node);
         this.#adj.set(node.id, []);
         maxNode = Math.max(maxNode, node.id);
      }
      for (const json of edges) {
         const a = this.#nodes.get(json.a);
         const b = this.#nodes.get(json.b);
         if (!a || !b) continue;
         const track = new Track(a, b, json.id);
         track.bumperA = json.bumperA ?? true;
         track.bumperB = json.bumperB ?? true;
         this.#registerTrack(track);
         maxEdge = Math.max(maxEdge, json.id);
      }
      this.#nextNodeId = maxNode + 1;
      this.#nextTrackId = maxEdge + 1;
      for (const node of this.#nodes.values()) this.refreshNode(node);
   }

   toJSON(): { nodes: NodeJSON[]; edges: EdgeJSON[] } {
      return {
         nodes: [...this.#nodes.values()].map((n) => n.toJSON()),
         edges: Track.allTracks.map((t) => t.toJSON()),
      };
   }

   getOrCreateNode(point: Point): Node {
      const existing = this.nodeAt(point);
      if (existing) return existing;
      const node = new Node(this.#nextNodeId++, point.x, point.y);
      this.#nodes.set(node.id, node);
      this.#byPoint.set(pointKey(node.location), node);
      this.#adj.set(node.id, []);
      return node;
   }

   addEdge(a: Node, b: Node): Track | null {
      if (a === b) return null;
      if (!nodeIsBefore(a, b)) [a, b] = [b, a];
      const existing = this.edgeBetween(a, b);
      if (existing) return existing;
      const track = new Track(a, b, this.#nextTrackId++);
      this.#registerTrack(track);
      this.refreshNode(a);
      this.refreshNode(b);
      return track;
   }

   edgeBetween(a: Node, b: Node): Track | undefined {
      return this.edgesAt(a).find((t) => t.otherNode(a) === b);
   }

   addPath(points: Point[]): Track[] | undefined {
      if (points == null || points.length <= 1) return;
      points = collapseCollinear(points);
      if (
         points[0].x > points[points.length - 1].x ||
         (points[0].x == points[points.length - 1].x && points[0].y > points[points.length - 1].y)
      ) {
         points.reverse();
      }
      const created: Track[] = [];
      for (let i = 0; i < points.length - 1; i++) {
         created.push(...this.#addSegment(points[i], points[i + 1]));
      }
      return created;
   }

   removeTrack(track: Track): void {
      for (const signal of [...track.signals]) Signal.removeSignal(signal);
      this.#unlink(track, track.nodeA);
      this.#unlink(track, track.nodeB);
      this.#tracks.delete(track.id);
      ArrayUtils.remove(Track.allTracks, track);
      this.#dropIfOrphan(track.nodeA);
      this.#dropIfOrphan(track.nodeB);
      if (this.#nodes.has(track.nodeA.id)) this.refreshNode(track.nodeA);
      if (this.#nodes.has(track.nodeB.id)) this.refreshNode(track.nodeB);
   }

   splitEdge(track: Track, point: Point): [Track, Track] | null {
      if (point.equals(track.start) || point.equals(track.end)) return null;
      if (!geometry.pointOnLine(track.start, track.end, point)) return null;
      const km = track.getKmfromPoint(point);
      const mid = this.getOrCreateNode(point);
      const left = new Track(track.nodeA, mid, this.#nextTrackId++);
      left.bumperA = track.bumperA;
      const right = new Track(mid, track.nodeB, this.#nextTrackId++);
      right.bumperB = track.bumperB;

      for (const signal of [...track.signals]) {
         track.removeSignal(signal);
         if (signal._positioning.km < km) {
            left.AddSignal(signal, signal._positioning.km, signal._positioning.above, signal._positioning.flipped);
         } else {
            right.AddSignal(signal, signal._positioning.km - km, signal._positioning.above, signal._positioning.flipped);
         }
      }

      this.#rehomeKm(track, (oldKm) => (oldKm < km ? { track: left, km: oldKm } : { track: right, km: oldKm - km }));

      const nodeA = track.nodeA;
      const nodeB = track.nodeB;
      this.#unlink(track, nodeA);
      this.#unlink(track, nodeB);
      this.#tracks.delete(track.id);
      ArrayUtils.remove(Track.allTracks, track);

      this.#registerTrack(left);
      this.#registerTrack(right);
      this.#remapSelected(track.id, left.id, nodeA);
      this.#remapSelected(track.id, right.id, nodeB);
      this.refreshNode(nodeA);
      this.refreshNode(mid);
      this.refreshNode(nodeB);
      return [left, right];
   }

   detachEdgeEnd(track: Track, end: "start" | "end", point: Point): void {
      const node = end === "start" ? track.nodeA : track.nodeB;
      if (this.degree(node) <= 1) {
         this.moveNode(node, point);
         return;
      }
      const next = this.getOrCreateNode(point);
      if (next === node) return;
      this.#retargetEnd(track, end, next);
   }

   moveNode(node: Node, point: Point): void {
      if (point.equals(node.location)) return;
      const dest = this.nodeAt(point);
      if (dest && dest !== node) {
         this.#mergeNodes(node, dest);
         return;
      }
      const incident = [...this.edgesAt(node)];
      const oldLengths = incident.map((t) => t.length);
      this.#byPoint.delete(pointKey(node.location));
      node.location.x = point.x;
      node.location.y = point.y;
      this.#byPoint.set(pointKey(node.location), node);
      for (let i = 0; i < incident.length; i++) {
         this.#afterGeometryChange(incident[i], node, oldLengths[i]);
      }
      const remaining = new Set<Node>([node]);
      for (const t of this.edgesAt(node)) remaining.add(t.otherNode(node));
      for (const n of remaining) this.refreshNode(n);
   }

   connectionAt(track: Track, node: Node): Switch | Track | null {
      return node.switchView ?? this.nextTrack(track, node);
   }

   nextTrack(track: Track, node: Node): Track | null {
      const incident = this.edgesAt(node);
      if (incident.length <= 1) return null;
      if (incident.length === 2) {
         const other = incident[0] === track ? incident[1] : incident[0];
         const angle = Switch.getAngleBetweenTracks(track, other);
         return angle && angle > 90 ? other : null;
      }
      const sw = node.switchView;
      if (!sw) return null;
      const chosen = node.selected[track.id];
      if (chosen != null) return this.#tracks.get(chosen) ?? null;
      for (const [entry, exit] of Object.entries(node.selected)) {
         if (Number(exit) === track.id) return this.#tracks.get(Number(entry)) ?? null;
      }
      return sw.defaultPartner(track);
   }

   refreshNode(node: Node): void {
      this.#pruneSelected(node);
      const tracks = this.edgesAt(node);
      if (tracks.length >= 3 && tracks.length <= 4 && Switch.isValidSwitch(node.location, tracks)) {
         if (!node.switchView) {
            node.switchView = new Switch(node);
            Switch.allSwitches.push(node.switchView);
         }
         node.switchView.bind(tracks);
      } else if (node.switchView) {
         ArrayUtils.remove(Switch.allSwitches, node.switchView);
         node.switchView = null;
      }
   }

   #addSegment(p1: Point, p2: Point): Track[] {
      if (p1.equals(p2)) return [];
      const points: Point[] = [p1, p2];
      for (const track of [...Track.allTracks]) {
         for (const p of [p1, p2]) {
            if (geometry.pointOnLine(track.start, track.end, p) && !p.equals(track.start) && !p.equals(track.end)) {
               points.push(p);
            }
         }
         const ix = geometry.getIntersectionPoint({ start: p1, end: p2 }, track);
         if (ix && ix.x % CONFIG.GRID_SIZE == 0 && ix.y % CONFIG.GRID_SIZE == 0) {
            points.push(ix);
         }
      }
      for (const node of this.#nodes.values()) {
         if (geometry.pointOnLine(p1, p2, node.location)) points.push(node.location);
      }
      const unique = uniquePoints(points);
      this.#splitTracksAtPoints(unique);
      unique.sort((a, b) => geometry.distance(p1, a) - geometry.distance(p1, b));
      const created: Track[] = [];
      for (let i = 0; i < unique.length - 1; i++) {
         const track = this.addEdge(this.getOrCreateNode(unique[i]), this.getOrCreateNode(unique[i + 1]));
         if (track) created.push(track);
      }
      return created;
   }

   #splitTracksAtPoints(points: Point[]): void {
      let changed = true;
      while (changed) {
         changed = false;
         for (const track of Track.allTracks) {
            const hit = points.find(
               (p) => geometry.pointOnLine(track.start, track.end, p) && !p.equals(track.start) && !p.equals(track.end)
            );
            if (hit) {
               changed = this.splitEdge(track, hit) != null;
               break;
            }
         }
      }
   }

   #registerTrack(track: Track): void {
      this.#tracks.set(track.id, track);
      Track.allTracks.push(track);
      this.#link(track, track.nodeA);
      this.#link(track, track.nodeB);
   }

   #link(track: Track, node: Node): void {
      const list = this.#adj.get(node.id);
      if (list && !list.includes(track)) list.push(track);
   }

   #unlink(track: Track, node: Node): void {
      const list = this.#adj.get(node.id);
      if (list) ArrayUtils.remove(list, track);
   }

   #dropIfOrphan(node: Node): void {
      if (this.degree(node) > 0) return;
      if (node.switchView) ArrayUtils.remove(Switch.allSwitches, node.switchView);
      this.#nodes.delete(node.id);
      this.#adj.delete(node.id);
      this.#byPoint.delete(pointKey(node.location));
   }

   #retargetEnd(track: Track, end: "start" | "end", next: Node): void {
      const prev = end === "start" ? track.nodeA : track.nodeB;
      if (prev === next) return;
      const oldLength = track.length;
      this.#unlink(track, prev);
      if (end === "start") track.nodeA = next;
      else track.nodeB = next;
      this.#link(track, next);
      track.resetCache();
      if (track.length === 0 || track.nodeA === track.nodeB) {
         this.removeTrack(track);
         this.#dropIfOrphan(prev);
         return;
      }
      this.#afterGeometryChange(track, next, oldLength);
      this.#dropIfOrphan(prev);
      if (this.#nodes.has(prev.id)) this.refreshNode(prev);
      this.refreshNode(next);
      this.refreshNode(track.otherNode(next));
   }

   #afterGeometryChange(track: Track, moved: Node, oldLength: number): void {
      track.resetCache();
      if (track.length === 0) {
         this.removeTrack(track);
         return;
      }
      const delta = track.nodeA === moved ? track.length - oldLength : 0;
      this.#mapKm(track, (km) => km + delta);
      this.#ensureOrder(track);
      track.resetCache();
   }

   #ensureOrder(track: Track): void {
      if (nodeIsBefore(track.nodeA, track.nodeB)) return;
      const length = track.length;
      const a = track.nodeA;
      track.nodeA = track.nodeB;
      track.nodeB = a;
      const bumperA = track.bumperA;
      track.bumperA = track.bumperB;
      track.bumperB = bumperA;
      this.#mapKm(track, (km) => length - km);
   }

   #mergeNodes(from: Node, to: Node): void {
      for (const track of [...this.edgesAt(from)]) {
         const other = track.otherNode(from);
         if (other === to || this.edgeBetween(to, other)) {
            this.removeTrack(track);
            continue;
         }
         const end = track.nodeA === from ? "start" : "end";
         this.#retargetEnd(track, end, to);
      }
      this.#dropIfOrphan(from);
      this.refreshNode(to);
   }

   #mapKm(track: Track, fn: (km: number) => number): void {
      const length = track.length;
      const clamp = (km: number) => Math.min(Math.max(fn(km), 0), length);
      for (const signal of track.signals) signal._positioning.km = clamp(signal._positioning.km);
      for (const train of Train.allTrains) {
         if (train.track === track && train.pos != null) train.pos = clamp(train.pos);
      }
      for (const crossing of RailwayCrossing.allCrossings) {
         for (const entry of crossing.entries) {
            if (entry.track === track) entry.km = clamp(entry.km);
         }
      }
   }

   #rehomeKm(track: Track, locate: (km: number) => { track: Track; km: number }): void {
      for (const train of Train.allTrains) {
         if (train.track !== track || train.pos == null) continue;
         const next = locate(train.pos);
         train.track = next.track;
         train.pos = next.km;
      }
      for (const crossing of RailwayCrossing.allCrossings) {
         for (const entry of crossing.entries) {
            if (entry.track !== track) continue;
            const next = locate(entry.km);
            entry.track = next.track;
            entry.trackId = next.track.id;
            entry.km = next.km;
         }
      }
   }

   #remapSelected(oldId: number, newId: number | null, node: Node | null): void {
      const targets = node ? [node] : [...this.#nodes.values()];
      for (const n of targets) {
         if (!n.selected || Object.keys(n.selected).length === 0) continue;
         const next: NodeSelected = {};
         for (const [entry, exit] of Object.entries(n.selected)) {
            const from = Number(entry) === oldId ? newId : Number(entry);
            const to = Number(exit) === oldId ? newId : Number(exit);
            if (from != null && to != null && from !== to) next[from] = to;
         }
         n.selected = next;
      }
   }

   #pruneSelected(node: Node): void {
      const ids = new Set(this.edgesAt(node).map((t) => t.id));
      const next: NodeSelected = {};
      for (const [entry, exit] of Object.entries(node.selected)) {
         const from = Number(entry);
         const to = Number(exit);
         if (ids.has(from) && ids.has(to) && from !== to) next[from] = to;
      }
      node.selected = next;
   }
}

function collapseCollinear(points: Point[]): Point[] {
   const filtered: Point[] = [];
   let curr = points[0];
   let prevSlope: number | null = null;
   for (let i = 0; i < points.length - 1; i++) {
      const next = points[i + 1];
      const slope = geometry.slope(curr, next);
      if (slope !== prevSlope) filtered.push(curr);
      prevSlope = slope;
      curr = next;
   }
   filtered.push(points[points.length - 1]);
   return filtered;
}

function uniquePoints(points: Point[]): Point[] {
   const unique: Point[] = [];
   for (const p of points) {
      if (!unique.some((u) => u.equals(p))) unique.push(p);
   }
   return unique;
}

export const railNetwork = new RailNetwork();
