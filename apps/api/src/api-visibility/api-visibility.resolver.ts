import "reflect-metadata";

import {
  INTERNAL_API_METADATA,
  type ApiVisibility,
  SUPPORTED_API_METADATA,
} from "./api-visibility.decorator.js";

type ControllerType = abstract new (...args: never[]) => unknown;
type Handler = (...args: never[]) => unknown;

function visibilityAt(target: object): ApiVisibility | undefined {
  const supported = Reflect.getOwnMetadata(SUPPORTED_API_METADATA, target) === true;
  const internal = Reflect.getOwnMetadata(INTERNAL_API_METADATA, target) === true;

  if (supported && internal) {
    throw new Error("API route must declare exactly one API visibility; both markers were found");
  }
  if (supported) {
    return "public-supported";
  }
  if (internal) {
    return "internal";
  }
  return undefined;
}

export function resolveApiVisibility(
  controller: ControllerType,
  handler: Handler,
): ApiVisibility {
  const methodVisibility = visibilityAt(handler);
  if (methodVisibility !== undefined) {
    return methodVisibility;
  }

  const controllerVisibility = visibilityAt(controller);
  if (controllerVisibility !== undefined) {
    return controllerVisibility;
  }

  throw new Error("API route must declare exactly one API visibility; no marker was found");
}
