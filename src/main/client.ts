import { Api } from './api'

import { Schemas } from '../schemas'
import { Like } from '../schemas/like'
import { EmojiAssociation } from '../schemas/emojiAssociation'
import { RerouteMessage } from '../schemas/rerouteMessage'
import { RerouteAssociation } from '../schemas/rerouteAssociation'
import { Userstreams } from '../schemas/userstreams'
import { AssociationID, CCID, Character, Domain, MessageID, StreamID } from '../model/core'
import { Message, Association, User, M_Current, M_Reroute, M_Reply, A_Favorite, A_Reply, A_Reroute, Stream, A_Reaction } from '../model/wrapper'
import { Profile as RawProfile } from '../schemas/profile'
import { SimpleNote } from '../schemas/simpleNote'
import { Commonstream } from '../schemas/commonstream'
import { Profile } from '../model/wrapper'
import { Socket } from './socket'
import {ReplyMessage} from "../schemas/replyMessage";
import {ReplyAssociation} from "../schemas/replyAssociation";
import { CommputeCCID, KeyPair, LoadKey } from "../util/crypto";

export class Client {
    api: Api
    ccid: CCID
    keyPair: KeyPair;

    constructor(privatekey: string, host: Domain, client?: string) {
        const keyPair = LoadKey(privatekey)
        if (!keyPair) throw new Error('invalid private key')
        this.keyPair = keyPair
        this.ccid = CommputeCCID(keyPair.publickey)
        this.api = new Api(this.ccid, privatekey, host, client)
    }

    async getUser(id: CCID): Promise<User | null> {
        const entity = await this.api.readEntity(id)
        if (!entity) return null
        const rawProfile: Character<RawProfile> | undefined = await this.api.readCharacter(id, Schemas.profile)
        const rawUserstreams: Character<Userstreams> | undefined = await this.api.readCharacter(id, Schemas.userstreams)

        let profile = undefined
        if (rawProfile) {
            profile = {
                id: rawProfile.id,
                schema: rawProfile.schema,
                cdate: new Date(rawProfile.cdate),
                ...rawProfile.payload.body
            }
        }

        let userstreams = undefined
        if (rawUserstreams) {
            userstreams = {
                id: rawUserstreams.id,
                schema: rawUserstreams.schema,
                cdate: new Date(rawUserstreams.cdate),
                ...rawUserstreams.payload.body
            }
        }

        return {
            ...entity,
            profile,
            userstreams
        }
    }

    async getStream(id: StreamID): Promise<Stream | null> {
        const stream = await this.api.readStream(id)
        if (!stream) return null
        return {
            id,
            schema: stream.schema,
            ...stream.payload.body
        }
    }

    async getAssociation(id: AssociationID, owner: CCID, deep: boolean = true): Promise<A_Favorite | A_Reaction | A_Reroute | A_Reply | null> {
        const association = await this.api.readAssociationWithOwner(id, owner).catch((e) => {
            console.log('CLIENT::getAssociation::readAssociationWithOwner::error', e)
            return null
        })
        if (!association) return null

        const author = await this.getUser(association.author).catch((e) => {
            console.log('CLIENT::getAssociation::getUser::error', e)
            return null
        })
        if (!author) return null

        const target = deep ? (await this.getMessage(association.targetID, owner, false).catch(() => null)) : null

        switch (association.schema) {
            case Schemas.like:
                return {
                    id: association.id,
                    schema: association.schema,
                    author,
                    cdate: new Date(association.cdate),
                    target,
                    ...association.payload.body
                } as A_Favorite
            case Schemas.emojiAssociation:
                return {
                    id: association.id,
                    schema: association.schema,
                    author,
                    cdate: new Date(association.cdate),
                    target,
                    ...association.payload.body
                } as A_Reaction
            case Schemas.replyAssociation:
                const replyBody = deep
                    ? (await this.getMessage(
                        association.payload.body.messageId,
                        association.payload.body.messageAuthor,
                        false).catch(() => null))
                    : null
                return {
                    id: association.id,
                    schema: association.schema,
                    author,
                    cdate: new Date(association.cdate),
                    target,
                    replyBody,
                    ...association.payload.body
                } as A_Reply
            case Schemas.rerouteAssociation:
                const rerouteBody = deep
                    ? (await this.getMessage(
                        association.payload.body.messageId,
                        association.payload.body.messageAuthor,
                        false).catch(() => null))
                    : null
                return {
                    id: association.id,
                    schema: association.schema,
                    author,
                    cdate: new Date(association.cdate),
                    target,
                    rerouteBody,
                    ...association.payload.body
                } as A_Reroute
            default:
                console.error('CLIENT::getAssociation::unknown schema', association.schema)
                return null
        }
    }

    async getMessage(id: MessageID, authorID: CCID, deep: boolean = true): Promise<M_Current | M_Reroute | M_Reply | null> {
        const message = await this.api.readMessageWithAuthor(id, authorID).catch((e) => {
            console.log('CLIENT::getMessage::readMessageWithAuthor::error', e)
            return null
        })
        if (!message) return null

        const author = await this.getUser(authorID).catch((e) => {
            console.log('CLIENT::getMessage::getUser::error', e)
            return null
        })
        if (!author) return null

        const allAssociations: Association[] = deep ? (await Promise.all(
            message.associations.map(async (e) => {
                return await this.getAssociation(e.id, authorID, false).catch((e) => {
                    console.log('CLIENT::getMessage::getAssociation::error', e)
                    return null
                })
            })
        )).filter((e: Association | null) => (e !== null)) as Association[] : []

        const favorites: A_Favorite[] =  allAssociations.filter((e) => e.schema === Schemas.like) as A_Favorite[]
        const reactions: A_Reaction[] = allAssociations.filter((e) => e.schema === Schemas.emojiAssociation) as A_Reaction[]
        const replies: A_Reply[] = allAssociations.filter((e) => e.schema === Schemas.replyAssociation) as A_Reply[]
        const reroutes: A_Reroute[] = allAssociations.filter((e) => e.schema === Schemas.rerouteAssociation) as A_Reroute[]

        const allstreams = (await Promise.all(
            message.streams.map(async (e) => await this.getStream(e).catch(() => null))
        )).filter((e: Stream | null) => (e !== null)) as Stream[]

        const streams: Commonstream[] = allstreams.filter((e: Stream) => e.schema === Schemas.commonstream)

        switch (message.schema) {
            case Schemas.simpleNote:
                return {
                    id: message.id,
                    ...message.payload.body,
                    schema: message.schema,
                    cdate: message.cdate,
                    author,
                    favorites,
                    reactions,
                    replies,
                    reroutes,
                    streams
                } as M_Current

            case Schemas.replyMessage:

                const replyTarget = await this.getMessage(
                    message.payload.body.replyToMessageId,
                    message.payload.body.replyToMessageAuthor
                ).catch(() => null)

                 return {
                    id: message.id,
                    ...message.payload.body,
                    schema: message.schema,
                    cdate: message.cdate,
                    author,
                    favorites,
                    reactions,
                    replies,
                    reroutes,
                    streams,
                    replyTarget
                } as M_Reply

            case Schemas.rerouteMessage:

                const rerouteTarget = await this.getMessage(
                    message.payload.body.rerouteMessageId,
                    message.payload.body.rerouteMessageAuthor
                ).catch(() => null)

                return {
                    id: message.id,
                    ...message.payload.body,
                    schema: message.schema,
                    cdate: message.cdate,
                    author,
                    favorites,
                    reactions,
                    replies,
                    reroutes,
                    streams,
                    rerouteTarget
                } as M_Reroute
            default:
                return null
        }
    }

    async getUserHomeStreams(users: StreamID[]): Promise<string[]> {
        return (
            await Promise.all(
                users.map(async (ccaddress: string) => {
                    const entity = await this.api.readEntity(ccaddress)
                    const character: Character<Userstreams> | undefined = await this.api.readCharacter(
                        ccaddress,
                        Schemas.userstreams
                    )

                    if (!character?.payload.body.homeStream) return undefined

                    let streamID: string = character.payload.body.homeStream
                    if (entity?.host && entity.host !== '') {
                        streamID += `@${entity.host}`
                    }
                    return streamID
                })
            )
        ).filter((e) => e) as string[]
    }

    async createCurrent(body: string, streams: StreamID[]): Promise<Error | null> {
        return await this.api.createMessage<SimpleNote>(Schemas.simpleNote, {body}, streams)
    }

    async setupUserstreams(): Promise<void> {
        const userstreams = await this.api.readCharacter(this.api.ccid, Schemas.userstreams)
        const id = userstreams?.id
        const res0 = await this.api.createStream(Schemas.utilitystream, {}, { writer: [this.api.ccid] })
        const homeStream = res0.id
        console.log('home', homeStream)

        const res1 = await this.api.createStream(Schemas.utilitystream, {}, {})
        const notificationStream = res1.id
        console.log('notification', notificationStream)

        const res2 = await this.api.createStream(Schemas.utilitystream, {}, { writer: [this.api.ccid] })
        const associationStream = res2.id
        console.log('notification', associationStream)

        this.api.upsertCharacter<Userstreams>(
            Schemas.userstreams,
            {
                homeStream,
                notificationStream,
                associationStream
            },
            id
        ).then((data) => {
            console.log(data)
        })
    }

    async favorite(target: Message): Promise<void> {
        const userStreams = await this.api.readCharacter(this.api.ccid, Schemas.userstreams)
        const authorInbox = target.author.userstreams?.notificationStream
        const targetStream = [authorInbox, userStreams?.payload.body.associationStream].filter((e) => e) as string[]
        await this.api.createAssociation<Like>(Schemas.like, {}, target.id, target.author.ccaddr, 'messages', targetStream)
        this.api.invalidateMessage(target.id)
    }

    async unFavorite(target: Message): Promise<void> {
        const associationID = target.favorites.find((e) => e.author.ccaddr === this.ccid)?.id
        if (!associationID) return
        const { content } = await this.api.deleteAssociation(associationID, target.author.ccaddr)
        this.api.invalidateMessage(content.targetID)
    }

    async addReaction(target: Message, shortcode: string, imageUrl: string): Promise<void> {
        const userStreams = await this.api.readCharacter(this.api.ccid, Schemas.userstreams)
        const authorInbox = target.author.userstreams?.notificationStream
        const targetStream = [authorInbox, userStreams?.payload.body.associationStream].filter((e) => e) as string[]
        await this.api.createAssociation<EmojiAssociation>(
            Schemas.emojiAssociation,
            {
                shortcode,
                imageUrl
            },
            target.id,
            target.author.ccaddr,
            'messages',
            targetStream
        )
        this.api.invalidateMessage(target.id)
    }

    async removeAssociation(target: Message, associationID: AssociationID): Promise<void> {
        const { content } = await this.api.deleteAssociation(associationID, target.author.ccaddr)
        this.api.invalidateMessage(content.targetID)
    }

    async reroute(id: MessageID, author: CCID, streams: StreamID[], body?: string): Promise<void> {
        const { content } = await this.api.createMessage<RerouteMessage>(
            Schemas.rerouteMessage,
            {
                body,
                rerouteMessageId: id,
                rerouteMessageAuthor: author
            },
            streams
        )
        const createdMessageId = content.id

        const userStreams = await this.api.readCharacter(this.api.ccid, Schemas.userstreams)
        const authorInbox = (await this.api.readCharacter(author, Schemas.userstreams))?.payload.body.notificationStream
        const targetStream = [authorInbox, userStreams?.payload.body.associationStream].filter((e) => e) as string[]

        await this.api.createAssociation<RerouteAssociation>(
            Schemas.rerouteAssociation,
            { messageId: createdMessageId, messageAuthor: this.api.ccid },
            id,
            author,
            'messages',
            targetStream
        )
    }

    async reply(id: MessageID, author: CCID, streams: StreamID[], body: string) {
        const data = await this.api.createMessage<ReplyMessage>(
          Schemas.replyMessage,
          {
              replyToMessageId: id,
              replyToMessageAuthor: author,
              body: body
          },
          streams
        )

        const userStreams = await this.api.readCharacter(this.api.ccid, Schemas.userstreams)
        const authorInbox = (await this.api.readCharacter(author, Schemas.userstreams))?.payload.body
          .notificationStream

        const targetStream = [authorInbox, userStreams?.payload.body.associationStream].filter(
          (e) => e
        ) as string[]

        await this.api.createAssociation<ReplyAssociation>(
          Schemas.replyAssociation,
          { messageId: data.content.id, messageAuthor: this.api.ccid },
          id,
          author,
          'messages',
          targetStream || []
        )
    }

    async deleteMessage(target: Message): Promise<void> {
        return this.api.deleteMessage(target.id)
    }


    async getCommonStreams(domain: Domain): Promise<Stream[]> {
        const streams = await this.api.getStreamListBySchema(Schemas.commonstream, domain)
        return streams.map((e) => { return {
            id: e.id,
            ...e.payload.body
        }})
    }

    async createCommonStream(name: string, description: string): Promise<void> {
        await this.api.createStream<Commonstream>(Schemas.commonstream, {
            name,
            shortname: name,
            description
        })
    }

    async createProfile(username: string, description: string, avatar: string, banner: string): Promise<Profile> {
        return await this.api.upsertCharacter<RawProfile>(Schemas.profile, {
            username,
            description,
            avatar,
            banner
        })
    }

    async updateProfile(id: string, username: string, description: string, avatar: string, banner: string): Promise<Profile> {
        return await this.api.upsertCharacter<RawProfile>(Schemas.profile, {
            username,
            description,
            avatar,
            banner
        }, id)
    }

    newSocket(): Socket {
        return new Socket(this.api.host)
    }
}
