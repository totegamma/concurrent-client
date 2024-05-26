import { Schema } from "../schemas"
import { CCDocument } from ".."

export type CCID = string
export type FQDN = string
export type TimelineID = string
export type MessageID = string
export type AssociationID = string
export type CharacterID = string
export type ProfileID = string

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
    alias?: string
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
    policy?: string
    policyParams?: string
    associations: Array<Association<any>>
    ownAssociations: Array<Association<any>>
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
    meta: Record<string, any>
}

export interface Timeline<T> {
    id: TimelineID
    indexable: boolean
    author: CCID
    domainOwned: boolean
    schema: CCID
    policy?: string
    policyParams?: string
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
    policy?: string
    policyParams?: string
    document: CCDocument.Subscription<T>
    signature: string
    items: SubscriptionItem[]
    cdate: string
    mdate: string
}

export enum ResolverType {
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

