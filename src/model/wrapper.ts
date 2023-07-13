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

export interface User extends CoreEntity {
    profile: Profile;
    userstreams: Userstreams;
}

export interface Message {
    schema: string;
    id: string;
    author: User;
    cdate: Date;

    streams: Stream[];

    favorites: A_Favorite[];
    reactions: A_Reaction[];
    replies: A_Reply[];
    reroutes: A_Reroute[];
}

export interface M_Current extends Message, T_MNote {}
export interface M_Reply extends Message, T_MReply {
    replyTarget: Message
}
export interface M_Reroute extends Message, T_MReroute {
    rerouteTarget: Message
}

export interface Association {
    id: string;
    author: User;
    cdate: Date;

    streams: Stream[];
}

export interface A_Favorite extends Association, T_AFavorite {}
export interface A_Reaction extends Association, T_AReaction {}
export interface A_Reply extends Association, T_AReply {}
export interface A_Reroute extends Association, T_AReroute {}

export interface Stream extends Commonstream {
    id: string;
}

