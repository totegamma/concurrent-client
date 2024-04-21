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
export { Commonstream as CommonstreamSchema } from "./schemas/commonstream"
export { DomainProfile as DomainProfileSchema } from "./schemas/domainProfile"
export { EmojiAssociation as EmojiAssociationSchema } from "./schemas/emojiAssociation"
export { Like as LikeSchema } from "./schemas/like"
export { Profile as ProfileSchema } from "./schemas/profile"
export { ReplyAssociation as ReplyAssociationSchema } from "./schemas/replyAssociation"
export { ReplyMessage as ReplyMessageSchema } from "./schemas/replyMessage"
export { RerouteAssociation as RerouteAssociationSchema } from "./schemas/rerouteAssociation"
export { RerouteMessage as RerouteMessageSchema } from "./schemas/rerouteMessage"
export { SimpleNote as SimpleNoteSchema } from "./schemas/simpleNote"
export { Userstreams as UserstreamsSchema } from "./schemas/userstreams"
export { Utilitystream as UtilityStreamSchema } from "./schemas/utilitystream"
export { UserAckCollection as UserAckCollectionSchema } from "./schemas/userAckCollection"
export { UserAck as UserAckSchema } from "./schemas/userAck"

export {
    CCID,
    Character as CoreCharacter,
    Entity as CoreEntity,
    Association as CoreAssociation,
    Message as CoreMessage,
    Domain as CoreDomain,
    Timeline as CoreTimeline,
    TimelineItem as CoreTimelineItem,
    Event as CoreEvent,
    Subscription as CoreSubscription,
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

