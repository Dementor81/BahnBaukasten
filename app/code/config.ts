"use strict";

/**
 * Application Configuration and Constants
 * This file contains all configuration values and constants used throughout the application
 */

// ============================================================================
// Main Application Config
// ============================================================================

export const CONFIG = {
    // Application metadata
    VERSION: "0.6",
    UPDATED: "2026-11-01",
    
    // Default settings
    DEFAULT_SIMPLIFIED_VIEW: true,
    
    // Grid and layout settings
    GRID_SIZE: 50,
    SNAP_TO_GRID: 5,
    GRID_STROKE_STYLE: 0.25,
    
    // Zoom and scaling
    MAX_SCALE: 20,
    MIN_SCALE: 0.2,
    
    // History and undo
    MOST_UNDO: 20,
} as const;

// ============================================================================
// Computed Values
// ============================================================================

export const COMPUTED = {
    GRID_SIZE_2: CONFIG.GRID_SIZE / 2,
} as const;

// ============================================================================
// Enums for Type-Safe Constants
// ============================================================================

export const DIRECTION = {
    LEFT_2_RIGHT: 1,
    RIGHT_2_LEFT: -1,
} as const;

export const CUSTOM_MOUSE_ACTION = {
    NONE: 0,
    DRAWING: 1,
    ERASER: 2,
    TEXT: 3,
    PLATTFORM: 4,
    TRAIN_COUPLE: 5,
    TRAIN_DECOUPLE: 6,
    RAILWAY_CROSSING: 7,
} as const;

export type CustomMouseAction = (typeof CUSTOM_MOUSE_ACTION)[keyof typeof CUSTOM_MOUSE_ACTION];

export const MENU = {
    EDIT_SIGNAL: 0,
    NEW_SIGNAL: 1,
    EDIT_TRAIN: 2,
    NEW_TRAIN: 3,
    NEW_OBJECT: 4,
    EDIT_OBJECT: 5,
    EDIT_TRACK: 6,
    EDIT_RAILWAY_CROSSING: 7,
} as const;

export type Menu = (typeof MENU)[keyof typeof MENU];

// ============================================================================
// Colors
// ============================================================================

export const COLORS = {
    GRID: "#ccc",
    GRID_LIGHT: "#ccc",
    GRID_DARK: "#555",
    SIGNAL_POSITION_LINE: "#e00",
    DRAWING_BLUEPRINT: "blue",
    DRAWING_ACTIVE: "#0000ff90",
    DRAWING_INVALID: "red",
    DRAWING_PLATTFORM: "#111111",
    
    // Train colors
    TRAIN_COLORS: ["#ff0000", "#ffff00", "#00ff00", "#0000ff"] as const,
};

// ============================================================================
// File Paths and Resources
// ============================================================================

export const PATHS = {
    IMAGES: "images",
    PREBUILDS: "prebuilds.xml",
} as const;

// ============================================================================
// Input Settings
// ============================================================================

export const INPUT = {
    MOUSE_MOVEMENT_THRESHOLD: 4, // pixels
    ZOOM_STEP_DIVISOR: 1000,
} as const;

// ============================================================================
// Container Names
// ============================================================================

export const CONTAINERS = {
    DEBUG: "debug",
    TRACKS: "tracks",
    OBJECTS: "objects",
    TRAINS: "trains",
    SIGNALS: "signals",
    UI: "ui",
    SELECTION: "selection",
    OVERLAY: "overlay",
    DRAWING: "drawing_container",
} as const;
