import {
    CoreEntity,
    Profile,
    Like as T_AFavorite,
    EmojiAssociation as T_AReaction,
    ReplyAssociation as T_AReply,
    ReplyMessage as T_MReply,
    RerouteAssociation as T_AReroute,
    RerouteMessage as T_MReroute,
    SimpleNote as T_MNote,
    Userstreams,
    Commonstream,
} from "..";

import { Schemas, Schema } from "../schemas";
import { AssociationID, MessageID } from "./core";

export interface User extends CoreEntity {
    profile: Profile;
    userstreams: Userstreams;
}

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

export interface M_Current extends Message, T_MNote {
    schema: typeof Schemas.simpleNote
}
export interface M_Reply extends Message, T_MReply {
    schema: typeof Schemas.replyMessage
    replyTarget: Message
}
export interface M_Reroute extends Message, T_MReroute {
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

export interface A_Favorite extends Association, T_AFavorite {
    schema: typeof Schemas.like
}
export interface A_Reaction extends Association, T_AReaction {
    schema: typeof Schemas.emojiAssociation
}
export interface A_Reply extends Association, T_AReply {
    schema: typeof Schemas.replyAssociation
    replyBody: M_Reply
}
export interface A_Reroute extends Association, T_AReroute {
    schema: typeof Schemas.rerouteAssociation
    rerouteBody: M_Reroute
}

export interface A_Unknown extends Association {}

export interface Stream extends Commonstream {
    id: string;
    schema: string;
}

