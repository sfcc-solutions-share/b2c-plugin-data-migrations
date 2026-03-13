declare module 'xml2js' {
  export function parseStringPromise(xml: string, options?: unknown): Promise<unknown>;
  export class Builder {
    constructor(options?: unknown);
    buildObject(obj: unknown): string;
  }
}
