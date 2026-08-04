import type { StructuredLogger } from "@booking-os/observability";

export const API_LOGGER_TOKEN = Symbol("API_LOGGER");
export const REQUEST_ID_GENERATOR_TOKEN = Symbol("REQUEST_ID_GENERATOR");
export const MONOTONIC_CLOCK_TOKEN = Symbol("MONOTONIC_CLOCK");
export const WALL_CLOCK_TOKEN = Symbol("WALL_CLOCK");

export type ApiLogger = StructuredLogger;
export type RequestIdGenerator = () => string;
export type MonotonicClock = () => number;
export type WallClock = () => Date;
