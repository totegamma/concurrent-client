import { Schema } from "../schemas"
import { CCDocument } from ".."

export type CCID = string
export type FQDN = string
export type TimelineID = string
export type MessageID = string
export type AssociationID = string
export type CharacterID = string
export type ProfileID = string
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
    enactDocument: string
    enactSignature: string
    revokeDocument?: string
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

    affiliationDocument: string
    affiliationSignature: string

    tombstoneDocument?: string
    tombstoneSignature?: string
}


export interface Association<T> {
    id: AssociationID
    author: CCID
    schema: Schema
    document: CCDocument.Association<T>
    _document: string
    signature: string
    target: MessageID
    cdate: string
}

export interface Message<T> {
    id: MessageID
    author: CCID
    schema: Schema
    document: CCDocument.Message<T>
    _document: string
    signature: string
    timelines: TimelineID[]
    associations: Array<Association<any>>
    ownAssociations: Array<Association<any>>
    cdate: string
}

export interface Character<T> {
    associations: Array<Association<any>>
    author: CCID
    schema: Schema
    id: CharacterID
    document: CCDocument.Profile<T>
    signature: string
    cdate: string
}

export interface Profile<T> {
    associations: Array<Association<any>>
    author: CCID
    schema: Schema
    id: ProfileID
    document: CCDocument.Profile<T>
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

export interface Timeline<T> {
    id: TimelineID
    indexable: boolean
    author: CCID
    domainOwned: boolean
    schema: CCID
    document: CCDocument.Timeline<T>
    signature: string
    cdate: string
    mdate: string
}

export interface Event {
    timeline: TimelineID
    item: TimelineItem
    document: string
    signature: string
    resource: Message<any> | Association<any>
}

export interface TimelineItem {
    cdate: Date
    resourceID: string
    timelineID: string
    author: string
    owner: string
    lastUpdate: Date
}

export interface Subscription<T> {
    id: string
    author: CCID
    indexable: boolean
    domainOwned: boolean
    schema: Schema
    document: CCDocument.Subscription<T>
    signature: string
    items: SubscriptionItem[]
    cdate: string
    mdate: string
}

enum ResolverType {
    Entity = 0,
    Domain = 1,
}

export interface SubscriptionItem {
    id: string
    resolverType: ResolverType
    entity: string
    domain: string
    subscription: string
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
    document: T
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
    document: string
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

