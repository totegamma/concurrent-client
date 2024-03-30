import { CCID } from ".."

export interface DocumentBase<S> {
    id?: string
    signer: string
    type: S
    keyID?: string
    meta?: any
    signedAt: Date
}

export interface DocumentBaseWithBody<T, S> extends DocumentBase<S> {
    schema: string
    body: T
}

export type Document<T, S> = DocumentBase<S> | DocumentBaseWithBody<T, S>


export interface AffiliationDocument extends DocumentBase<'affiliation'> {
    domain: string
}

export interface MessageDocument<T> extends DocumentBaseWithBody<T, 'message'> {
    timelines: string[]
}

export interface AssociationDocument<T> extends DocumentBaseWithBody<T, 'association'> {
    target: string
    owner: string
    variant: string
    timelines: string[]
}

export type ProfileDocument<T> = DocumentBaseWithBody<T, 'profile'>


export interface DeleteDocument extends DocumentBase<'delete'> {
    target: string
}

export type ExtensionDocument<T> = DocumentBaseWithBody<T, 'extension'>

export interface TimelineDocument<T> extends DocumentBaseWithBody<T, 'timeline'> {
    indexable: boolean
    domainOwned: boolean
}

export interface AckDocument extends DocumentBase<'ack'> {
    from: CCID
    to: CCID
}

export interface UnackDocument extends DocumentBase<'unack'> {
    from: CCID
    to: CCID
}

export interface EnactDocument extends DocumentBase<'enact'> {
    target: string
    root: string
    parent: string
}

export interface RevokeDocument extends DocumentBase<'revoke'> {
    target: string
}

