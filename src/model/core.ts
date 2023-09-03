import { Schema } from "../schemas"

export type CCID = string
export type FQDN = string
export type StreamID = string
export type MessageID = string
export type AssociationID = string
export type CharacterID = string
export type CollectionID = string
export type CollectionItemID = string

export interface SignedObject<T> {
    signer: CCID
    type: string
    schema: Schema
    body: T
    meta: any
    signedAt: string
    target?: string
}

export interface Entity {
    ccid: CCID
    tag: string
    domain: FQDN 
    cdate: string
    score: number
    certs: Certificate[]
}

export interface Association<T> {
    author: CCID
    cdate: string
    id: AssociationID
    payload: T
    schema: Schema
    signature: string
    targetID: MessageID
    targetType: 'message' | 'character'
}

export interface Message<T> {
    associations: Array<Association<any>>
    author: CCID
    cdate: string
    id: MessageID
    payload: SignedObject<T>
    rawpayload: string
    schema: Schema
    signature: string
    streams: StreamID[]
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
    payload: SignedObject<T>
    signature: string
    cdate: string
}

export interface ServerEvent {
    stream: StreamID
    type: string
    action: string
    body: StreamElement
}

export interface StreamElement {
    timestamp: string
    id: string
    type: string
    author: string
    owner: string
    domain: string
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

