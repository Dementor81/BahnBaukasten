"use strict";

import { geometry, V2, Point } from "./tools.ts";
import type { Switch } from "./switch.ts";
import { Signal } from "./signal.ts";
import { CONFIG } from "./config.ts";
import { EditorCommitter } from "./editorCommitter.ts";
import { Application } from "./application.ts";
import type { Node } from "./node.ts";
import { railNetwork } from "./railNetwork.ts";

export class Track {
   static allTracks: Track[] = [];

   static isValidTrackNodePoint(p: Point, nodes: Point[] | null): boolean {
      if (!nodes || nodes.length === 0) return true;
      const lastNode = nodes[nodes.length - 1];
      if (p.equals(lastNode)) return true;
      if (p.x === lastNode.x && p.y != lastNode.y) return false;

      if (nodes.length >= 2) {
         const secondLastNode = nodes[nodes.length - 2];
         const xDirection = Math.sign(lastNode.x - secondLastNode.x);
         const newXDirection = Math.sign(p.x - lastNode.x);
         if (xDirection !== 0 && newXDirection !== xDirection) return false;

         const v1 = { x: lastNode.x - secondLastNode.x, y: lastNode.y - secondLastNode.y };
         const v2 = { x: p.x - lastNode.x, y: p.y - lastNode.y };
         const angle1 = Math.atan2(v1.y, v1.x);
         const angle2 = Math.atan2(v2.y, v2.x);
         let angleDiff = Math.abs(angle1 - angle2);
         if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
         if (angleDiff > Math.PI / 4) return false;
      }
      return true;
   }

   static snapToGrid(local: Point): Point {
      return new Point(
         Math.round(local.x / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE,
         Math.round(local.y / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE
      );
   }

   static findTrackByPoint(p: Point): Track | undefined {
      return Track.allTracks.find((track) => geometry.pointOnLine(track.start, track.end, p));
   }

   static initEditTrackMenu(track: Track): void {
      $("#inputBumper").off("change");
      $("#inputBumper").prop("checked", track.hasBumper);
      $("#inputBumper").on("change", (e: any) => {
         track.hasBumper = e.target.checked;
         EditorCommitter.commit();
         Application.getInstance().renderingManager!.reDrawEverything(true);
      });
      $("#btnRemoveTrack").off("click");
      $("#btnRemoveTrack").on("click", () => {
         Application.getInstance().deleteSelectedObject();
      });
   }

   id: number;
   nodeA: Node;
   nodeB: Node;
   bumperA: boolean = true;
   bumperB: boolean = true;
   #_signals: Signal[] = [];
   #_vector: { x: number; y: number } | null = null;
   #_rad: number | null = null;
   #_deg: number | null = null;
   #_length: number | null = null;
   #_unit: V2 | null = null;
   #_slope: number | null = null;
   #_sin: number | null = null;
   #_cos: number | null = null;

   constructor(nodeA: Node, nodeB: Node, id: number = 0) {
      this.id = id;
      this.nodeA = nodeA;
      this.nodeB = nodeB;
   }

   get start(): Point {
      return this.nodeA.location;
   }

   get end(): Point {
      return this.nodeB.location;
   }

   get hasBumper(): boolean {
      return this.bumperA && this.bumperB;
   }

   set hasBumper(value: boolean) {
      this.bumperA = value;
      this.bumperB = value;
   }

   get vector(): { x: number; y: number } {
      if (!this.#_vector) {
         this.#_vector = { x: this.end.x - this.start.x, y: this.end.y - this.start.y };
      }
      return this.#_vector;
   }

   get rad(): number {
      if (!this.#_rad) this.#_rad = Math.atan2(this.vector.y, this.vector.x);
      return this.#_rad;
   }

   get deg(): number {
      if (!this.#_deg) this.#_deg = this.rad * (180 / Math.PI);
      return this.#_deg;
   }

   get length(): number {
      if (!this.#_length) this.#_length = geometry.length(this.vector);
      return this.#_length;
   }

   get unit(): V2 {
      if (!this.#_unit) this.#_unit = new V2(geometry.unit(this.vector, this.length));
      return this.#_unit;
   }

   get slope(): number {
      return this.#_slope ? this.#_slope : (this.#_slope = this.vector.y / this.vector.x);
   }

   get sin(): number {
      if (!this.#_sin) this.#_sin = Math.sin(this.rad);
      return this.#_sin;
   }

   get cos(): number {
      if (!this.#_cos) this.#_cos = Math.cos(this.rad);
      return this.#_cos;
   }

   get signals(): Signal[] {
      return this.#_signals;
   }

   connectionAt(node: Node): Switch | Track | null {
      return railNetwork.connectionAt(this, node);
   }

   otherNode(node: Node): Node {
      return node === this.nodeA ? this.nodeB : this.nodeA;
   }

   resetCache(): void {
      this.#_vector = null;
      this.#_rad = null;
      this.#_deg = null;
      this.#_length = null;
      this.#_unit = null;
      this.#_slope = null;
      this.#_sin = null;
      this.#_cos = null;
   }

   getPointFromKm(km: number): Point {
      if (km < 0 || km > this.length) throw new Error("Km exceeds track length");
      return geometry.add(this.start, geometry.multiply(this.unit, km));
   }

   getKmfromPoint(p: Point): number {
      if (p.equals(this.start)) return 0;
      if (!geometry.pointOnLine(this.start, this.end, p)) throw new Error("Point is not on the track.");
      return geometry.distance(this.start, p);
   }

   AddSignal(signal: Signal, km?: number, above?: boolean, flipped?: boolean): void {
      signal._positioning.km = km!;
      signal._positioning.track = this;
      signal._positioning.above = above!;
      signal._positioning.flipped = flipped!;
      const i = this.#_signals.findIndex((s) => km! < s._positioning.km);
      if (i != -1) this.#_signals.splice(i, 0, signal);
      else this.#_signals.push(signal);
   }

   removeSignal(s: Signal): void {
      const i = this.#_signals.indexOf(s);
      if (i != -1) this.#_signals.splice(i, 1);
   }

   toJSON(): { id: number; a: number; b: number; bumperA: boolean; bumperB: boolean } {
      return {
         id: this.id,
         a: this.nodeA.id,
         b: this.nodeB.id,
         bumperA: this.bumperA,
         bumperB: this.bumperB,
      };
   }
}
