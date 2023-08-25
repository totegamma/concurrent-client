import {
    CoreEntity,
    RawProfile,
    RawCommonstream,
    RawUserstreams,
    RawLike,
    RawEmojiAssociation,
    RawReplyAssociation,
    RawReplyMessage,
    RawRerouteAssociation,
    RawRerouteMessage,
    RawSimpleNote,
    RawUserAck,
} from "..";


import { Schemas, Schema } from "../schemas";
import { AssociationID, CharacterID, MessageID } from "./core";

export interface User extends CoreEntity {
    profile?: Profile;
    userstreams?: Userstreams;
}

export interface Character {
    id: CharacterID;
    schema: Schema;
    cdate: Date;
}

export interface Userstreams extends Character, RawUserstreams {}
export interface Profile extends Character, RawProfile {
    ackedby: User[]
}
export interface Commonstream extends Character, RawCommonstream {}

export interface Message {
    id: MessageID;
    schema: Schema
    author: User;
    cdate: Date;

    streams: Stream[];

    favorites: A_Favorite[];
    reactions: A_Reaction[];
    replies: A_Reply[];
    reroutes: A_Reroute[];
}

export interface M_Current extends Message, RawSimpleNote {
    schema: typeof Schemas.simpleNote
}
export interface M_Reply extends Message, RawReplyMessage {
    schema: typeof Schemas.replyMessage
    replyTarget: Message
}
export interface M_Reroute extends Message, RawRerouteMessage {
    schema: typeof Schemas.rerouteMessage
    rerouteTarget: Message
}

export interface Association {
    id: AssociationID;
    schema: Schema
    author: User;
    cdate: Date;
    target: Message;
}

export interface A_UserAck extends Association, RawUserAck {
    schema: typeof Schemas.userAck
}

export interface A_Favorite extends Association, RawLike {
    schema: typeof Schemas.like
}
export interface A_Reaction extends Association, RawEmojiAssociation {
    schema: typeof Schemas.emojiAssociation
}
export interface A_Reply extends Association, RawReplyAssociation {
    schema: typeof Schemas.replyAssociation
    replyBody: M_Reply
}
export interface A_Reroute extends Association, RawRerouteAssociation {
    schema: typeof Schemas.rerouteAssociation
    rerouteBody: M_Reroute
}


export interface A_Unknown extends Association {}

export interface Stream extends RawCommonstream {
    id: string;
    schema: string;
    author: string;
    maintainer: string[];
    writer: string[];
    reader: string[];
    cdate: Date;
}

