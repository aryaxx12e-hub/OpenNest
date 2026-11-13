import { ValidationError, type IsoDate } from "@opennest/core";

export function requireAt(at: IsoDate | undefined): IsoDate {
  if (at === undefined) {
    throw new ValidationError(
      "A timestamp is required. Adapters never read the clock; the service supplies it."
    );
  }

  return at;
}

export function laterOf(left: IsoDate, right: IsoDate): IsoDate {
  return left > right ? left : right;
}
