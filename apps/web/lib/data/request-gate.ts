export interface RequestGate {
  begin: () => number;
  isCurrent: (request: number) => boolean;
}

export function createRequestGate(): RequestGate {
  let current = 0;

  return {
    begin() {
      current += 1;

      return current;
    },
    isCurrent(request) {
      return current === request;
    },
  };
}
