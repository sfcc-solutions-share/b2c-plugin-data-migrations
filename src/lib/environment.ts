/*
 * Copyright (c) 2025, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2
 * For full license text, see the license.txt file in the repo root or http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Legacy environment adapter for backward compatibility with b2c-tools migration scripts.
 *
 * Provides axios-like `.ocapi`, `.webdav`, and `.scapi` clients so existing scripts
 * that destructure `{ env }` and call `env.ocapi.get(...)` etc. work unchanged.
 */
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import type {WebDavClient} from '@salesforce/b2c-tooling-sdk/clients';
import {resolveAuthStrategy} from '@salesforce/b2c-tooling-sdk/auth';
import type {AuthStrategy} from '@salesforce/b2c-tooling-sdk/auth';

// ---------------------------------------------------------------------------
// Axios-like response / error wrappers
// ---------------------------------------------------------------------------

interface AxiosLikeResponse {
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

class AxiosLikeError extends Error {
  response: AxiosLikeResponse;
  constructor(message: string, response: AxiosLikeResponse) {
    super(message);
    this.name = 'AxiosLikeError';
    this.response = response;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function wrapResponse(response: Response): Promise<AxiosLikeResponse> {
  const headers = headersToRecord(response.headers);
  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = response.headers.get('content-length');

  let data: unknown;
  if (response.status === 204 || contentLength === '0') {
    data = undefined;
  } else if (contentType.includes('json')) {
    data = await response.json();
  } else {
    const arrayBuf = await response.arrayBuffer();
    data = Buffer.from(arrayBuf);
  }

  const wrapped: AxiosLikeResponse = {
    data,
    status: response.status,
    statusText: response.statusText,
    headers,
  };

  if (!response.ok) {
    throw new AxiosLikeError(
      `Request failed with status ${response.status}`,
      wrapped,
    );
  }

  return wrapped;
}

// ---------------------------------------------------------------------------
// LegacyHttpClient — shared base for OCAPI and SCAPI
// ---------------------------------------------------------------------------

class LegacyHttpClient {
  constructor(
    private baseUrl: string,
    private auth: AuthStrategy,
  ) {}

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  private async request(
    method: string,
    path: string,
    data?: unknown,
  ): Promise<AxiosLikeResponse> {
    const url = this.buildUrl(path);
    const init: RequestInit = {method};

    if (data !== undefined) {
      init.headers = {'Content-Type': 'application/json'};
      init.body = JSON.stringify(data);
    }

    const response = await this.auth.fetch(url, init);
    return wrapResponse(response);
  }

  async get(path: string): Promise<AxiosLikeResponse> {
    return this.request('GET', path);
  }

  async post(path: string, data?: unknown): Promise<AxiosLikeResponse> {
    return this.request('POST', path, data);
  }

  async put(path: string, data?: unknown): Promise<AxiosLikeResponse> {
    return this.request('PUT', path, data);
  }

  async patch(path: string, data?: unknown): Promise<AxiosLikeResponse> {
    return this.request('PATCH', path, data);
  }

  async delete(path: string): Promise<AxiosLikeResponse> {
    return this.request('DELETE', path);
  }
}

// ---------------------------------------------------------------------------
// LegacyWebdavClient — wraps SDK WebDavClient with axios-like responses
// ---------------------------------------------------------------------------

class LegacyWebdavClient {
  constructor(private webdav: WebDavClient) {}

  async get(path: string): Promise<AxiosLikeResponse> {
    const response = await this.webdav.request(path, {method: 'GET'});
    return wrapResponse(response);
  }

  async put(path: string, data?: RequestInit['body']): Promise<AxiosLikeResponse> {
    const response = await this.webdav.request(path, {method: 'PUT', body: data});
    return wrapResponse(response);
  }

  async post(path: string, data?: RequestInit['body']): Promise<AxiosLikeResponse> {
    const response = await this.webdav.request(path, {method: 'POST', body: data});
    return wrapResponse(response);
  }

  async delete(path: string): Promise<AxiosLikeResponse> {
    const response = await this.webdav.request(path, {method: 'DELETE'});
    return wrapResponse(response);
  }

  async request(path: string, init?: RequestInit): Promise<AxiosLikeResponse> {
    const response = await this.webdav.request(path, init);
    return wrapResponse(response);
  }
}

// ---------------------------------------------------------------------------
// LegacyEnvironment — the public adapter class
// ---------------------------------------------------------------------------

export class LegacyEnvironment {
  readonly server: string;
  readonly clientID: string;
  readonly codeVersion: string | undefined;
  readonly shortCode: string | undefined;

  readonly ocapi: LegacyHttpClient;
  readonly webdav: LegacyWebdavClient;

  private _auth: AuthStrategy;
  private _scapi: LegacyHttpClient | undefined;

  constructor(instance: B2CInstance, options?: {shortCode?: string}) {
    this.server = instance.config.hostname;
    this.clientID = instance.auth.oauth?.clientId ?? '';
    this.codeVersion = instance.config.codeVersion;
    this.shortCode = options?.shortCode;

    this._auth = resolveAuthStrategy({...instance.auth.oauth});
    this.ocapi = new LegacyHttpClient(
      `https://${instance.config.hostname}/s/-/dw/data/v25_6`,
      this._auth,
    );
    this.webdav = new LegacyWebdavClient(instance.webdav);
  }

  get scapi(): LegacyHttpClient {
    if (!this.shortCode) {
      throw new Error('SCAPI clients require a shortCode configured');
    }
    if (!this._scapi) {
      this._scapi = new LegacyHttpClient(
        `https://${this.shortCode}.api.commercecloud.salesforce.com`,
        this._auth,
      );
    }
    return this._scapi;
  }
}
