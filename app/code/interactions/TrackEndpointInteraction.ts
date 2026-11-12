"use strict";

import type { FederatedPointerEvent } from "pixi.js";
import { Application } from "../application.ts";
import { CONFIG } from "../config.ts";
import { EditorCommitter } from "../editorCommitter.ts";
import { geometry, Point } from "../tools.ts";
import { Track } from "../track.ts";
import { RailwayCrossing } from "../railway_crossing.ts";
import { PointerInteractionAttachment } from "./attachPointerInteraction.ts";
import type { PointerInteraction } from "./PointerInteraction.ts";
import { railNetwork } from "../railNetwork.ts";

/** Drag a track endpoint to reposition it on the grid. Shift moves a shared junction. */
export class TrackEndpointInteraction implements PointerInteraction {
   readonly planLockPolicy = "block" as const;

   constructor(
      private track: Track,
      private endpoint: "start" | "end"
   ) {}

   onMove(local: Point, e: FederatedPointerEvent): void {
      const rm = Application.getInstance().renderingManager!;
      const gridSnap = Track.snapToGrid(local);

      const moved = this.endpoint === "start" ? this.track.start : this.track.end;
      if (geometry.distance(local, gridSnap) <= CONFIG.SNAP_TO_GRID && !gridSnap.equals(moved)) {
         const [start, end] = this.endpoint === "start" ? [gridSnap, this.track.end] : [this.track.start, gridSnap];
         if (start.x < end.x || (start.x === end.x && start.y < end.y)) {
            const node = this.endpoint === "start" ? this.track.nodeA : this.track.nodeB;
            if (e.shiftKey) railNetwork.moveNode(node, gridSnap);
            else railNetwork.detachEdgeEnd(this.track, this.endpoint, gridSnap);
            RailwayCrossing.refreshAfterTrackGeometryChange(this.track, 0);
            rm.renderer.reDrawEverything(true);
         }
      }

      rm.update();
   }

   onUp(_local: Point, _e: FederatedPointerEvent): void {
      const rm = Application.getInstance().renderingManager!;
      rm.renderer.reDrawEverything(true);
      rm.update();
      EditorCommitter.commit();
   }

   static attach(container: any, track: Track, endpoint: "start" | "end"): void {
      PointerInteractionAttachment.attach(container, () => new TrackEndpointInteraction(track, endpoint));
   }
}
