import { CCID } from ".."

export interface DocumentBase<S> {
    id?: string
    signer: string
    type: S
    keyID?: string
    meta?: any
    semanticID?: string
    signedAt: Date
    policy?: string
    policyParams?: string
    policyDefaults?: string
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

export interface TimelineDocument<T> extends DocumentBaseWithBody<T, 'timeline'> {
    owner: string
    indexable: boolean
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

export interface SubscriptionDocument<T> extends DocumentBaseWithBody<T, 'subscription'> {
    owner: string
    indexable: boolean
}

export interface SubscribeDocument extends DocumentBase<'subscribe'> {
    target: string
    subscription: string
}

export interface UnsubscribeDocument extends DocumentBase<'unsubscribe'> {
    target: string
    subscription: string
}

export interface RetractDocument extends DocumentBase<'retract'> {
    timeline: string
    target: string
}

