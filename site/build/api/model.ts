// The API reference as the extraction produces it and the pages render it.

export type ApiKind = 'function' | 'component' | 'class' | 'interface' | 'type' | 'variable';

/** Where an API symbol or member is documented: its entry and its anchor there. */
export interface ApiTarget {
  /** The entry as in addresses, such as `core/indicators`. */
  readonly entry: string;
  /** `createChart`, or `DataApi.set` for a member. */
  readonly anchor: string;
}

/** A part of a declaration that names another symbol of the API. */
export interface ApiCodeLink {
  readonly start: number;
  readonly end: number;
  readonly target: ApiTarget;
}

/** A declaration as shown: the source without its comment, body and `export`. */
export interface ApiCode {
  readonly text: string;
  readonly links: readonly ApiCodeLink[];
}

/** A file and line of the repository, from 1. */
export interface ApiSource {
  readonly file: string;
  readonly line: number;
}

export interface ApiMember {
  readonly name: string;
  readonly anchor: string;
  /** One declaration, or one per overload. */
  readonly code: readonly ApiCode[];
  /** The comment as Markdown, links to the API written `api:<entry>#<anchor>`. */
  readonly doc: string;
  readonly source: ApiSource;
}

export interface ApiSymbol {
  readonly name: string;
  readonly kind: ApiKind;
  readonly entry: string;
  readonly code: readonly ApiCode[];
  readonly doc: string;
  /** Members of interfaces and classes, props of components. */
  readonly members: readonly ApiMember[];
  readonly source: ApiSource;
}

/** An entry point of a package, such as `@kumochart-sdk/core/indicators`. */
export interface ApiEntry {
  /** As in addresses and API links: `core`, `core/indicators`, `vue`. */
  readonly name: string;
  /** As imported. */
  readonly specifier: string;
  /** The symbols documented on the entry's page. */
  readonly symbols: readonly ApiSymbol[];
  /** What the entry exports that another entry documents. */
  readonly reexports: readonly { readonly name: string; readonly target: ApiTarget }[];
}

/** A comment that names nothing of the API, or a type of the API that is not exported. */
export interface ApiWarning {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface ApiModel {
  readonly entries: readonly ApiEntry[];
  readonly warnings: readonly ApiWarning[];
}

/** The prefix of links to the API in comments, as `api:core#createChart`. */
export const API_SCHEME = 'api:';
