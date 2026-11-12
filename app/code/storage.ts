"use strict";

// ES6 Module imports
import { Signal } from './signal.ts';
import { Train } from './train.ts';
import { GenericObject } from './generic_object.ts';
import { RailwayCrossing } from './railway_crossing.ts';
import { ArrayUtils } from './utils.ts';
import { ui } from './ui.ts';
import { CONFIG } from './config.ts';
import { Application } from './application.ts';
import { AdvancedRendering } from './rendering/advanced/AdvancedRendering.ts';
import { getCDataValue } from './tools.ts';
import { railNetwork } from './railNetwork.ts';

// ============================================================================
// Type Definitions
// ============================================================================

interface SavedSettings {
   zoom: number;
   scrollX: number;
   scrollY: number;
   renderer: "advanced" | "basic" | "textured";
}

interface UserPrefs {
   darkMode?: boolean;
}

interface LoadedData {
   nodes?: any[];
   edges?: any[];
   tracks?: any[];
   trains?: any[];
   switches?: any[];
   signals?: any[];
   objects?: any[];
   crossings?: any[];
   settings?: SavedSettings;
}

// ============================================================================
// STORAGE Object
// ============================================================================

let scheduledSaveTimer: ReturnType<typeof setTimeout> | undefined;

export const STORAGE = {
   MIN_STORAGE_VERSION: 0.5 as const,
   STORAGE_IDENT: "bahnhof_last1" as const,
   PREFS_IDENT: "bahnhof_prefs" as const,

   getPrefs(): UserPrefs {
      try {
         const raw = localStorage.getItem(STORAGE.PREFS_IDENT);
         if (!raw) return {};
         return JSON.parse(raw) as UserPrefs;
      } catch {
         return {};
      }
   },

   getDarkMode(): boolean {
      return STORAGE.getPrefs().darkMode === true;
   },

   setDarkMode(enabled: boolean): void {
      const prefs = STORAGE.getPrefs();
      prefs.darkMode = enabled;
      localStorage.setItem(STORAGE.PREFS_IDENT, JSON.stringify(prefs));
   },

   /**
    * JSON replacer function for stringifying objects
    */
   replacer(_key: string, value: any): any {
      return typeof value?.stringify === "function" ? value.stringify() : value;
   },

   /**
    * Get the complete save string with version prefix
    */
   getSaveString(): string {
      return (
         CONFIG.VERSION +
         ";" +
         STORAGE.getJSONString()
      );
   },

   /**
    * Get JSON string of current application state
    */
   getJSONString(include_settings: boolean = true): string {
      const app = Application.getInstance();
      const rm = app.renderingManager as any;
      
      let settings: SavedSettings | null = null;
      if (include_settings && rm) {
         const viewport = rm.viewport;
         const renderer = rm.renderer;
         if (viewport && renderer) {
            settings = {
               zoom: viewport.scale.x,
               scrollX: viewport.x,
               scrollY: viewport.y,
               renderer: renderer instanceof AdvancedRendering ? "advanced" : "basic",
            };
         }
      }
      
      return JSON.stringify(
         {
            ...railNetwork.toJSON(),
            signals: [...Signal.allSignals],
            trains: Train.allTrains,
            objects: GenericObject.all_objects,
            crossings: RailwayCrossing.allCrossings,
            settings: settings,
         },
         STORAGE.replacer
      );
   },

   /**
    * Restore the last undo step
    */
   restoreLastUndoStep(): void {
      const app = Application.getInstance();
      if (app.undoHistory.length <= 1) return;
      app.undoHistory.pop();
      const last = ArrayUtils.last(app.undoHistory) as string | undefined;
      if (last) {
         STORAGE.loadFromJson(last);
      } else {
         railNetwork.clear();
      }

      const uiManager = app.uiManager as any;
      if (uiManager) uiManager.updateUndoButtonState();
   },

   /**
    * Load application state from JSON string
    */
   loadFromJson(json: string): void {
      const raw: LoadedData = JSON.parse(json);
      const loaded = Array.isArray(raw.nodes) ? raw : migrateOldSave(raw);
      (window as any).app.renderingManager.clear(false);

      if (loaded.settings) {
         const vp = (window as any).app.renderingManager.viewport;
         vp.x = loaded.settings.scrollX;
         vp.y = loaded.settings.scrollY;
         vp.scale.set(loaded.settings.zoom);
         if (loaded.settings.renderer) {
            (window as any).app.renderingManager.selectRenderer(
               loaded.settings.renderer === "advanced" || loaded.settings.renderer === "textured"
            );
         }
      }

      railNetwork.load(loaded.nodes ?? [], loaded.edges ?? []);
      for (const signal of loaded.signals ?? []) Signal.FromObject(signal);
      Signal.migrateRenderOrder();

      if (loaded.objects) {
         GenericObject.all_objects = loaded.objects.map((o: any) => (o instanceof GenericObject ? o : GenericObject.FromObject(o)));
      }
      RailwayCrossing.allCrossings = (loaded.crossings ?? []).map((o: any) =>
         o instanceof RailwayCrossing ? o : RailwayCrossing.FromObject(o)
      );
      RailwayCrossing.counter = RailwayCrossing.allCrossings.length
         ? Math.max(...RailwayCrossing.allCrossings.map((crossing) => crossing.id)) + 1
         : 0;

      RailwayCrossing.allCrossings.forEach((crossing) => crossing.relinkTracks());
      RailwayCrossing.allCrossings = RailwayCrossing.allCrossings.filter((crossing) => crossing.entries.length > 0);

      Train.allTrains = (loaded.trains ?? []).map((o: any) => (o instanceof Train ? o : Train.FromObject(o)));
      Train.allTrains.forEach((t: any) => t.restore());
      Train.allTrains.forEach((t: any) => {
         delete t.trainCoupledFrontId;
         delete t.trainCoupledBackId;
         delete t.savedEdge;
         delete t.savedKm;
      });
      Train.allTrains = Train.allTrains.filter((t: any) => t.track != null);

      Application.getInstance().renderingManager?.notifyViewportChanged();
   },

   /**
    * Save current state to undo history
    */
   saveUndoHistory(): void {
      const app = Application.getInstance();
      app.undoHistory.push(STORAGE.getJSONString(false));
      if (app.undoHistory.length > CONFIG.MOST_UNDO) {
         app.undoHistory.shift();
      }

      const uiManager = app.uiManager as any;
      if (uiManager) uiManager.updateUndoButtonState();
   },

   /**
    * Save current state to localStorage
    */
   save(): void {
      clearTimeout(scheduledSaveTimer);
      scheduledSaveTimer = undefined;
      const start = performance.now();
      localStorage.setItem(STORAGE.STORAGE_IDENT, STORAGE.getSaveString());
      const rm = Application.getInstance().renderingManager;
      if (rm) rm.stats.saveMs = performance.now() - start;
   },

   /** Trailing save 400 ms after the last call, for high-frequency changes such as zoom/pan. */
   scheduleSave(): void {
      clearTimeout(scheduledSaveTimer);
      scheduledSaveTimer = setTimeout(() => STORAGE.save(), 400);
   },

   /**
    * True if localStorage has a version-tagged save we can pass to loadRecent().
    */
   hasRecentSave(): boolean {
      const x = localStorage.getItem(STORAGE.STORAGE_IDENT);
      if (x == null) return false;
      const sep = x.indexOf(";");
      if (sep <= 0) return false;
      const v = parseFloat(x.substring(0, sep));
      return !Number.isNaN(v) && v >= STORAGE.MIN_STORAGE_VERSION;
   },

   /**
    * Load most recent save from localStorage
    */
   loadRecent(): void {
      try {
         const x = localStorage.getItem(STORAGE.STORAGE_IDENT);
         if (x != null) {
            const indexOfFirst = x.indexOf(";");
            if (indexOfFirst > -1) {
               const loaded_version = parseFloat(x.substring(0, indexOfFirst));
               if (loaded_version >= STORAGE.MIN_STORAGE_VERSION) {
                  STORAGE.loadFromJson(x.slice(indexOfFirst + 1));
               } else {
                  console.error(`stored version ${loaded_version} too old`);
               }
            } else {
               throw new Error("Version Tag is missing");
            }
            STORAGE.saveUndoHistory();
         }
      } catch (error) {
         ui.showErrorToast(error as Error);
      }
      const uiManager = Application.getInstance().uiManager as any;
      if (uiManager) uiManager.updateUndoButtonState();
   },

   /**
    * Load a prebuild layout by name from prebuilds.xml
    */
   loadPrebuildbyName(name: string): Promise<void> {
      return new Promise((resolve, reject) => {
         const xmlhttp = new XMLHttpRequest();
         xmlhttp.onreadystatechange = function () {
            if (this.readyState == 4 && this.status == 200) {
               const xmlDoc = this.responseXML;
               if (!xmlDoc) {
                  reject(new Error("Failed to parse XML"));
                  return;
               }

               const setups = xmlDoc.getElementsByTagName("setup");
               for (let i = 0; i < setups.length; i++) {
                  const titleElement = setups[i].getElementsByTagName("title")[0];
                  if (titleElement && titleElement.textContent == name) {
                     const jsonElement = setups[i].getElementsByTagName("json")[0];
                     const jsonText = getCDataValue(jsonElement);
                     if (jsonText) {
                        STORAGE.loadFromJson(jsonText);
                        resolve();
                        return;
                     }
                  }
               }
               reject(new Error("Prebuild not found"));
            }
         };
         xmlhttp.open("GET", "prebuilds.xml" + "?" + Math.floor(Math.random() * 100), true);
         xmlhttp.send();
      });
   },

   /**
    * Download current state as XML file
    */
   downloadAsFile(): void {
      const xmlStr = `<?xml version="1.0" encoding="UTF-8"?>
      <setup>
      <date>${new Date().toLocaleString()}</date>
      <version>${CONFIG.VERSION}</version>
      <json>
          ${STORAGE.getJSONString(false)}
      </json>
      </setup> `;
  
      const a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(xmlStr);
      a.download = 'bahnhof.xml';
      a.click();
   },

   /**
    * Restore state from uploaded file
    */
   async restoreFromFile(): Promise<void> {
      return new Promise((resolve, reject) => {
         const input = document.createElement('input');
         input.type = 'file';
         input.accept = "text/xml";
         input.onchange = (_e: Event) => {
            if (!input.files || input.files.length == 0) {
               ui.showErrorToast(new Error("keine datei hochgeladen!"));
               reject(new Error("keine datei hochgeladen!"));
               return;
            }

            const file = input.files[0];

            if (file.size > 512 * 1024) {
               ui.showErrorToast(new Error("Dateigröße darf 512kb nicht überschreiten!"));
               reject(new Error("Dateigröße darf 512kb nicht überschreiten!"));
               return;
            }

            if (input.accept != file.type) {
               ui.showErrorToast(new Error("falsches Dateiformat!"));
               reject(new Error("falsches Dateiformat!"));
               return;
            }

            const reader = new FileReader();
            reader.readAsText(file, 'UTF-8');

            reader.onload = (readerEvent: ProgressEvent<FileReader>) => {
               try {
                  const content = readerEvent.target?.result as string;
                  if (!content) {
                     reject(new Error("File is empty"));
                     return;
                  }
                  
                  const xmlDoc = new DOMParser().parseFromString(content, "text/xml");
                  const jsonElement = xmlDoc.getElementsByTagName("json")[0];
                  const versionElement = xmlDoc.getElementsByTagName("version")[0];
                  
                  const json = jsonElement?.childNodes[0]?.nodeValue;
                  const versionStr = versionElement?.childNodes[0]?.nodeValue;
                  
                  if (!json || !versionStr) {
                     reject(new Error("Invalid file format"));
                     return;
                  }
                  
                  const version = parseFloat(versionStr);
                  if (version < STORAGE.MIN_STORAGE_VERSION) {
                     ui.showErrorToast(new Error("Diese Datei ist zu alt!"));
                     reject(new Error("Diese Datei ist zu alt!"));
                     return;
                  }
                  
                  STORAGE.loadFromJson(json);
                  resolve();
               } catch (err) {
                  ui.showErrorToast(err as Error);
                  reject(err);
               }
            };

            reader.onerror = (_err: ProgressEvent<FileReader>) => {
               const error = new Error("Failed to read file");
               ui.showErrorToast(error);
               reject(error);
            };
         };
         input.click();
      });
   }, 
};

function migrateOldSave(data: LoadedData): LoadedData {
   const nodes: { id: number; x: number; y: number; selected?: Record<number, number> }[] = [];
   const nodeByKey = new Map<string, (typeof nodes)[0]>();
   const nodeAt = (p: { x: number; y: number }) => {
      const key = `${p.x},${p.y}`;
      let node = nodeByKey.get(key);
      if (!node) {
         node = { id: nodes.length, x: p.x, y: p.y };
         nodeByKey.set(key, node);
         nodes.push(node);
      }
      return node;
   };

   const edges: { id: number; a: number; b: number; bumperA: boolean; bumperB: boolean }[] = [];
   const signals: any[] = [];
   for (const track of data.tracks ?? []) {
      const a = nodeAt(track.start);
      const b = nodeAt(track.end);
      const bumper = track.hasBumper != null ? track.hasBumper : true;
      edges.push({ id: track.id, a: a.id, b: b.id, bumperA: bumper, bumperB: bumper });
      for (const signal of track.signals ?? []) {
         signals.push({
            _template: signal._template,
            _signalStellung: signal._signalStellung,
            _renderOrder: signal._renderOrder,
            edge: track.id,
            km: signal._positioning?.km ?? 0,
            above: signal._positioning?.above ?? false,
            flipped: signal._positioning?.flipped ?? false,
         });
      }
   }

   for (const sw of data.switches ?? []) {
      const node = nodeByKey.get(`${sw.location.x},${sw.location.y}`);
      if (!node || sw.from == null || sw.branch == null) continue;
      node.selected ??= {};
      node.selected[sw.from] = sw.branch;
      const ids = (sw.tracks ?? []).filter(Boolean);
      if (ids.length === 4) {
         const others = ids.filter((id: number) => id !== sw.from && id !== sw.branch);
         if (others.length === 2) node.selected[others[0]] = others[1];
      }
   }

   const crossings = (data.crossings ?? []).map((crossing: any) => ({
      ...crossing,
      entries: (crossing.entries ?? []).map((entry: any) => ({
         ...entry,
         trackId: entry.edge ?? entry.trackId,
      })),
   }));

   return {
      nodes,
      edges,
      signals,
      trains: data.trains ?? [],
      objects: data.objects ?? [],
      crossings,
      settings: data.settings,
   };
}

