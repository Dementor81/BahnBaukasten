type SignalInitialAspects = string | string[];

export interface SignalMenuButtonItem {
   text: string;
   command: string;
}

interface SignalMenuButtonDefinition {
   button: SignalMenuButtonItem;
}

interface SignalMenuDropdownDefinition {
   dropdown: SignalMenuButtonItem;
}

export interface SignalTextInputDefinition {
   text: string;
   command: string;
   maxLength?: number;
}

interface SignalMenuTextInputDefinition {
   textinput: SignalTextInputDefinition;
}

interface SignalMenuButtonGroupDefinition {
   buttonGroup: SignalMenuButtonItem[];
}

export type SignalMenuItemDefinition =
   | SignalMenuButtonGroupDefinition
   | SignalMenuButtonDefinition
   | SignalMenuDropdownDefinition
   | SignalMenuTextInputDefinition;

interface SignalMenuSectionDefinition {
   section: SignalMenuItemDefinition[];
}

export type SignalMenuDefinition = SignalMenuSectionDefinition[];

export interface SignalMenuRuntimeButton {
   type: 'button';
   text: string;
   command: string;
   visual_elements: unknown[];
}

export interface SignalMenuRuntimeDropdown {
   type: 'dropdown';
   text: string;
   command: string;
   visual_elements: unknown[];
}

interface SignalMenuRuntimeButtonGroup {
   type: 'buttonGroup';
   items: SignalMenuRuntimeButton[];
}

export interface SignalMenuRuntimeTextInput {
   type: 'textinput';
   text: string;
   command: string;
   maxLength?: number;
}

export type SignalMenuRuntimeItem =
   | SignalMenuRuntimeButtonGroup
   | SignalMenuRuntimeButton
   | SignalMenuRuntimeDropdown
   | SignalMenuRuntimeTextInput;

interface SignalMenuRuntimeSection {
   section: SignalMenuRuntimeItem[];
}

export type SignalMenuRuntime = SignalMenuRuntimeSection[];

export type SignalElementDefinition =
   | string
   | SignalVisualElementDefinition
   | SignalTextElementDefinition
   | SignalElementDefinition[];

export interface SignalRotationDefinition {
   element?: string | string[];
   angle: number;
   pivot?: [number, number];
   duration?: number;
}

export type SignalRotationConfig = SignalRotationDefinition | SignalRotationDefinition[];

export interface SignalFlipDefinition {
   element?: string | string[];
   scaleY: 0 | 1;
   pivot?: [number, number];
   duration?: number;
}

export type SignalFlipConfig = SignalFlipDefinition | SignalFlipDefinition[];

export interface SignalSequenceStepDefinition {
   element: string;
   duration?: number;
}

export type AspectAnimationKind = "rotation" | "flip" | "sequence";

export interface SequenceState {
   controllerOn: string | null;
   stepIndex: number;
   elapsedMs: number;
}

type SignalBlendMode = "multiply";

interface SignalVisualElementDefinition {
   label?: string;
   image?: string;
   pos?: [number, number];
   on?: string;
   off?: string;
   blinks?: boolean;
   blendMode?: SignalBlendMode;
   rotation?: SignalRotationConfig;
   flip?: SignalFlipConfig;
   sequence?: SignalSequenceStepDefinition[];
   children?: SignalElementDefinition[];
}

export interface SignalTextElementDefinition {
   text: string;
   format?: Array<string | number>;
   color?: string;
   pos: [number, number];
   on?: string;
   off?: string;
   blinks?: boolean;
}

export interface SignalConfigSwitchOptionDefinition {
   name: string;
   title: string;
   convertTo?: string;
   type?: 'switch';
}

interface SignalConfigTextOptionDefinition extends SignalTextInputDefinition {
   type: 'textinput';
}

export type SignalConfigOptionDefinition = SignalConfigSwitchOptionDefinition | SignalConfigTextOptionDefinition;

type PublishRule = [condition: string, value: string | number];

export interface SignalDependencyDefinition {
   when?: string[];
   unless?: string[];
   publish?: {
      route?: PublishRule[];
      currentSpeed?: PublishRule[];
   };
   subscribe?: {
      vr?: { route: Record<string, number> };
      hp?: { route: Record<string, number> };
   };
   overrides?: Array<[string, Record<string, string | number>]>;
   stopUnless?: string;
}

export interface SignalTemplateDefinition {
   id: string;
   title: string;
   atlas: string;
   elements?: SignalElementDefinition[];
   initial?: SignalInitialAspects;
   scale?: number;
   previewsize?: number;
   /** Extra pixels between track outer edge and signal. Omit for no extra gap. */
   padding?: number;
   menu?: SignalMenuDefinition;
   rules?: Array<[string, string]>;
   config_options?: SignalConfigOptionDefinition[];
   dependency?: SignalDependencyDefinition;
}
