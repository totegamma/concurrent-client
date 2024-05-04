export * from "./main/client"
export * from "./main/socket"
export * from "./main/timeline"
export * from "./main/subscription"
export * from "./main/api"
export * from "./model/request"
export * from "./model/others"
export * from "./util/crypto"
export * from "./util/misc"

export * from "./schemas"
export * from "./schemas/"

export {
    CCID,
    Entity as CoreEntity,
    Association as CoreAssociation,
    Profile as CoreProfile,
    Message as CoreMessage,
    Domain as CoreDomain,
    Timeline as CoreTimeline,
    TimelineItem as CoreTimelineItem,
    Event as CoreEvent,
    Subscription as CoreSubscription,
    SubscriptionItem as CoreSubscriptionItem,
    Key as CoreKey,
} from "./model/core"

export { TimelineEvent } from "./main/socket"

import {
    Document,
    AffiliationDocument,
    MessageDocument,
    ProfileDocument,
    AssociationDocument,
    TimelineDocument,
    DeleteDocument,
    AckDocument,
    UnackDocument,
    EnactDocument,
    RevokeDocument,
    SubscriptionDocument,
    SubscribeDocument,
    UnsubscribeDocument,
} from "./model/document"

export namespace CCDocument {
    export type Base<T, S> = Document<T, S>
    export type Affiliation = AffiliationDocument
    export type Message<T> = MessageDocument<T>
    export type Profile<T> = ProfileDocument<T>
    export type Association<T> = AssociationDocument<T>
    export type Timeline<T> = TimelineDocument<T>
    export type Delete = DeleteDocument
    export type Ack = AckDocument
    export type Unack = UnackDocument
    export type Enact = EnactDocument
    export type Revoke = RevokeDocument
    export type Subscription<T> = SubscriptionDocument<T>
    export type Subscribe = SubscribeDocument
    export type Unsubscribe = UnsubscribeDocument
}

