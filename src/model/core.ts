import { Schema } from "../schemas"

export type CCID = string
export type FQDN = string
export type StreamID = string
export type MessageID = string
export type AssociationID = string
export type CharacterID = string
export type CollectionID = string
export type CollectionItemID = string

export interface AffiliationOption {
    info: string
    invitation?: string
}

export interface CommitRequest {
    document: string
    signature: string
    option?: string
}

// ---

export interface SignedObject<T> {
    signer: CCID
    type: string
    schema?: Schema
    body: T
    meta?: any
    signedAt: Date
    target?: string
    variant?: string
    keyID?: string
}

export interface keyEnact {
    CKID: string
    root: string
    parent: string
}

export interface keyRevoke {
    CKID: string
}

export interface Key {
    id: string
    root: string
    parent: string
    enactPayload: string
    enactSignature: string
    revokePayload?: string
    revokeSignature?: string
    validSince: string
    validUntil: string
}

export interface Entity {
    ccid: CCID
    tag: string
    domain: FQDN 
    cdate: string
    score: number
    certs: Certificate[]
    payload: string
    signature: string
}

export interface Association<T> {
    id: AssociationID
    author: CCID
    schema: Schema
    payload: SignedObject<T>
    rawpayload: string
    signature: string
    targetID: MessageID
    targetType: 'messages' | 'characters'
    cdate: string
}

export interface Message<T> {
    id: MessageID
    author: CCID
    schema: Schema
    payload: SignedObject<T>
    rawpayload: string
    signature: string
    streams: StreamID[]
    associations: Array<Association<any>>
    ownAssociations: Array<Association<any>>
    cdate: string
}

export interface Character<T> {
    associations: Array<Association<any>>
    author: CCID
    schema: Schema
    id: CharacterID
    payload: SignedObject<T>
    signature: string
    cdate: string
}

export interface Domain {
    fqdn: FQDN
    ccid: CCID
    tag: string
    pubkey: string
    cdate: Date
    score: number
}

export interface Stream<T> {
    id: StreamID
    visible: boolean
    author: CCID
    maintainer: CCID[]
    writer: CCID[]
    reader: CCID[]
    schema: CCID
    payload: T
    cdate: string
}

export interface StreamEvent {
    type: string
    action: string
    stream: string
    item: StreamItem
    body: Message<any> | Association<any>
}

export interface StreamItem {
    cdate: Date
    objectID: string
    streamID: string
    type: string
    author: string
    owner: string
    lastUpdate: Date
}

export interface Collection<T> {
    id: string
    visible: boolean
    author: CCID
    maintainer: CCID[]
    writer: CCID[]
    reader: CCID[]
    schema: Schema
    cdate: Date
    mdate: Date
    items: CollectionItem<T>[]
}

export interface CollectionItem<T> {
    id: string
    collectionId: string
    payload: T
}

export interface Certificate {
    icon: string
    description: string
}

export interface ProfileOverride {
    username?: string;
    avatar?: string;
    description?: string;
    link?: string;
    characterID?: string;
}

export interface Ack {
    from: string
    to: string
    payload: string
    signature: string
}

export interface AckObject {
    from: string
    to: string
}

export interface AckRequest {
    signedObject: string
    signature: string
}

