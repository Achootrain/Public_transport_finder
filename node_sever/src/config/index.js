/**
 * @module config
 * @description Centralised application configuration.
 *
 * Loads environment variables via `dotenv` and exposes transit-specific
 * constants used throughout the pathfinding and traffic services.
 *
 * ## Key Constants
 * | Name                   | Default | Usage                        |
 * |------------------------|---------|------------------------------|
 * | `PORT`                 | 3001    | Express HTTP server port     |
 * | `BUS_SPEED`            | 16 km/h | Fallback bus edge velocity   |
 * | `METRO_SPEED`          | 35 km/h | Fixed metro edge velocity    |
 * | `WALKING_SPEED`        | 4 km/h  | Walking edge velocity        |
 * | `WAITING_BUS`          | 900 s   | Average bus wait penalty     |
 * | `WAITING_METRO`        | 900 s   | Average metro wait penalty   |
 * | `DEFAULT_VELOCITY_MIN` | 15 km/h | Random init lower bound      |
 * | `DEFAULT_VELOCITY_MAX` | 35 km/h | Random init upper bound      |
 *
 * @see module:repositories/graph.traverse — uses speed & waiting constants
 */
require('dotenv').config();

/** @type {import('./types').AppConfig} */
module.exports = {
    /** @type {number} Server port */
    PORT: Number(process.env.PORT) || 3001,

    /** @type {number} Average bus speed in km/h */
    BUS_SPEED: 16,

    /** @type {number} Average metro speed in km/h */
    METRO_SPEED: 35,

    /** @type {number} Average walking speed in km/h */
    WALKING_SPEED: 4,

    /** @type {number} Average waiting time for bus in seconds */
    WAITING_BUS: 15 * 60,

    /** @type {number} Average waiting time for metro in seconds */
    WAITING_METRO: 15 * 60,

    /** @type {number} Minimum default edge velocity in km/h */
    DEFAULT_VELOCITY_MIN: 15,

    /** @type {number} Maximum default edge velocity in km/h */
    DEFAULT_VELOCITY_MAX: 35,
};
