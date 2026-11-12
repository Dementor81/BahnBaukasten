"use strict";

import { NumberUtils, ArrayUtils } from "./utils.ts";
import { Track } from "./track.ts";
import { V2, Point, geometry, swap } from "./tools.ts";
import type { Node } from "./node.ts";

export class Switch {
   static allSwitches: Switch[] = [];

   static SWITCH_TYPE = {
      NONE: 0,
      TO_RIGHT: 1,
      FROM_RIGHT: 2,
      FROM_LEFT: 3,
      TO_LEFT: 4,
      DKW: 9,
   };

   static isCompleteForRendering(sw: Switch): boolean {
      return !!(
         sw.track1 &&
         sw.track2 &&
         sw.track3 &&
         (sw.type !== Switch.SWITCH_TYPE.DKW || sw.track4)
      );
   }

   static getAngleBetweenTracks(track1: Track, track2: Track): number | null {
      let intersection: Point | null = null;
      if (track1.start.equals(track2.start) || track1.start.equals(track2.end)) {
         intersection = track1.start;
      } else if (track1.end.equals(track2.start) || track1.end.equals(track2.end)) {
         intersection = track1.end;
      } else {
         return null;
      }
      const v1_p = track2.start.equals(intersection) ? track2.end : track2.start;
      const v2_p = track1.start.equals(intersection) ? track1.end : track1.start;
      return geometry.calculateAngle(intersection, v1_p, v2_p);
   }

   static findAngle(sw: Point, c: Point, rad: number = 0): number {
      let atan = Math.atan2(c.y - sw.y, c.x - sw.x) - rad;
      if (atan < 0) atan += 2 * Math.PI;
      return (atan * 180) / Math.PI;
   }

   static isValidSwitch(location: Point, tracks: Track[]): boolean {
      if (!location) return false;
      if (!NumberUtils.between(tracks.length, 3, 4)) return false;
      const slopes = tracks.map((t) => t.slope);
      const equal_slopes = ArrayUtils.countNonUnique(slopes);
      if (!((tracks.length == 3 && equal_slopes == 1) || (tracks.length == 4 && equal_slopes == 2))) {
         return false;
      }
      for (let i = 1; i < slopes.length; i++) {
         if (Math.abs(slopes[i - 1] - slopes[i]) > 1) return false;
      }
      return true;
   }

   static switch_A_Switch(sw: Switch, mouseX: number): void {
      if (!NumberUtils.is(sw.type, Switch.SWITCH_TYPE.DKW)) {
         sw.branch = swap(sw.branch, sw.track2, sw.track3);
      } else if (mouseX < sw.location.x) {
         sw.branch = swap(sw.branch, sw.track2, sw.track3);
      } else {
         sw.from = swap(sw.from, sw.track1, sw.track4);
      }
      sw.writeSelected();
   }

   node: Node;
   type: number = Switch.SWITCH_TYPE.NONE;
   tracks: (Track | null)[] = new Array(4).fill(null);
   branch: Track | null = null;
   from: Track | null = null;
   track_directions: (V2 | null)[] = new Array(4);
   angle: number = 0;
   slope: number = 0;

   constructor(node: Node) {
      this.node = node;
   }

   get id(): number {
      return this.node.id;
   }

   get location(): Point {
      return this.node.location;
   }

   get track1(): Track | null {
      return this.tracks[0];
   }
   set track1(track: Track | null) {
      this.tracks[0] = track;
   }
   get track2(): Track | null {
      return this.tracks[1];
   }
   set track2(track: Track | null) {
      this.tracks[1] = track;
   }
   get track3(): Track | null {
      return this.tracks[2];
   }
   set track3(track: Track | null) {
      this.tracks[2] = track;
   }
   get track4(): Track | null {
      return this.tracks[3];
   }
   set track4(track: Track | null) {
      this.tracks[3] = track;
   }

   bind(tracks: Track[]): void {
      const location = this.location;
      const left_tracks = tracks.filter((t) => t.end.equals(location)).sort((a, b) => b.slope - a.slope);
      const right_tracks = tracks.filter((t) => t.start.equals(location)).sort((a, b) => b.slope - a.slope);

      this.tracks = new Array(4).fill(null);
      if (left_tracks.length == 1) {
         this.track1 = left_tracks[0];
         this.track2 = right_tracks.find((t) => t.rad == this.track1!.rad) ?? null;
      } else if (right_tracks.length >= 1) {
         this.track1 = right_tracks[0];
         this.track2 = left_tracks.find((t) => t.rad == this.track1!.rad) ?? null;
      }
      if (!this.track1 || !this.track2) return;

      const rest = tracks.filter((t) => t != this.track1 && t != this.track2).sort((a, b) => a.start.x - b.start.x);
      this.track3 = rest[0] ?? null;
      this.track4 = rest[1] ?? null;

      this.syncRoute();
      this.calculateParameters();
   }

   syncRoute(): void {
      const selected = this.node.selected;
      const entry = [this.track1, this.track4].find((t) => t && selected[t.id] != null);
      this.from = entry ?? this.track1;
      this.branch = (entry ? this.trackById(selected[entry.id]) : null) ?? this.track2;
   }

   writeSelected(): void {
      const selected: Record<number, number> = {};
      if (this.from && this.branch) selected[this.from.id] = this.branch.id;
      if (this.track4 && this.from && this.branch) {
         const fromAlt = this.from === this.track1 ? this.track4 : this.track1;
         const branchAlt = this.branch === this.track2 ? this.track3 : this.track2;
         if (fromAlt && branchAlt) selected[fromAlt.id] = branchAlt.id;
      }
      this.node.selected = selected;
   }

   calculateParameters(): void {
      if (!this.track1 || !this.track2 || !this.track3) return;

      this.track_directions = this.tracks.map((track) =>
         track ? (track.end.equals(this.location) ? V2.fromV2(track.unit).invert() : V2.fromV2(track.unit)) : null
      );

      const angle = Switch.findAngle(
         this.location,
         this.track3!.end.equals(this.location) ? this.track3!.start : this.track3!.end,
         this.track1!.rad
      );

      this.slope = this.track3!.slope - this.track2!.slope;
      this.angle = geometry.degToRad(Switch.getAngleBetweenTracks(this.track2!, this.track3!)!);

      if (this.track4) this.type = Switch.SWITCH_TYPE.DKW;
      else this.type = Math.ceil((angle % 360) / 90);
   }

   defaultPartner(track: Track): Track | null {
      if (track === this.track1) return this.track2;
      if (track === this.track2) return this.track1;
      if (track === this.track3) return this.track4 ?? this.track1;
      if (track === this.track4) return this.track3;
      return null;
   }

   private trackById(id: number | undefined): Track | null {
      if (id == null) return null;
      return this.tracks.find((t) => t?.id === id) ?? null;
   }
}
