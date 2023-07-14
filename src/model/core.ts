import { Schema } from "../schemas"

export type CCID = string
export type Domain = string
export type StreamID = string
export type MessageID = string
export type AssociationID = string
export type CharacterID = string

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
    ccaddr: CCID
    role: string
    host: string
    cdate: string
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

export interface Host {
    fqdn: Domain
    ccaddr: CCID
    role: string
    pubkey: string
    cdate: Date
}

export interface Stream<T> {
    id: StreamID
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
    currenthost: string
}

