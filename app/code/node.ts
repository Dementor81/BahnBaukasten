"use strict";

import { Point } from "./tools.ts";
import type { Switch } from "./switch.ts";

export type NodeSelected = Record<number, number>;

export class Node {
   id: number;
   readonly location: Point;
   selected: NodeSelected = {};
   switchView: Switch | null = null;

   constructor(id: number, x: number, y: number, selected?: NodeSelected) {
      this.id = id;
      this.location = new Point(x, y);
      if (selected) this.selected = selected;
   }

   get x(): number {
      return this.location.x;
   }

   get y(): number {
      return this.location.y;
   }

   toJSON(): { id: number; x: number; y: number; selected?: NodeSelected } {
      const json: { id: number; x: number; y: number; selected?: NodeSelected } = {
         id: this.id,
         x: this.x,
         y: this.y,
      };
      if (Object.keys(this.selected).length > 0) json.selected = this.selected;
      return json;
   }
}

export function pointKey(p: { x: number; y: number }): string {
   return `${p.x},${p.y}`;
}

export function parseSelected(raw: Record<string, number> | NodeSelected | undefined): NodeSelected {
   const selected: NodeSelected = {};
   if (!raw) return selected;
   for (const [key, value] of Object.entries(raw)) selected[Number(key)] = Number(value);
   return selected;
}

export function nodeIsBefore(a: Node, b: Node): boolean {
   return a.x < b.x || (a.x === b.x && a.y < b.y);
}
