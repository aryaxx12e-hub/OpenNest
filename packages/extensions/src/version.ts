import { ExtensionError } from "./errors";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function versionParts(value: string): readonly [bigint, bigint, bigint] {
  const match = VERSION_PATTERN.exec(value);
  const major = match?.[1];
  const minor = match?.[2];
  const patch = match?.[3];

  if (major === undefined || minor === undefined || patch === undefined) {
    throw new ExtensionError(
      "invalid_version",
      `Version must use major.minor.patch, received ${JSON.stringify(value)}.`
    );
  }

  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined || rightPart === undefined) {
      continue;
    }

    if (leftPart < rightPart) {
      return -1;
    }

    if (leftPart > rightPart) {
      return 1;
    }
  }

  return 0;
}
