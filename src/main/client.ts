import { Api } from './api'

import { Schemas } from '../schemas'
import { Like } from '../schemas/like'
import { EmojiAssociation } from '../schemas/emojiAssociation'
import { RerouteMessage } from '../schemas/rerouteMessage'
import { RerouteAssociation } from '../schemas/rerouteAssociation'
import { Userstreams } from '../schemas/userstreams'
import { AssociationID, CCID, Character, Domain, MessageID, StreamID } from '../model/core'
import { Message, Association, User, M_Current, M_Reroute, M_Reply, A_Favorite, A_Reply, A_Reroute, Stream, A_Reaction } from '../model/wrapper'
import { Profile } from '../schemas/profile'
import { SimpleNote } from '../schemas/simpleNote'
import { Commonstream } from '../schemas/commonstream'

export class Client {
    api: Api
    ccid: CCID

    constructor(ccid: CCID, privatekey: string, host: Domain, client?: string) {
        this.ccid = ccid
        this.api = new Api(ccid, privatekey, host, client)
    }

    async getUser(id: CCID): Promise<User | null> {
        const entity = await this.api.readEntity(id)
        const profile: Character<Profile> | undefined = await this.api.readCharacter(id, Schemas.profile)
        const userstreams: Character<Userstreams> | undefined = await this.api.readCharacter(id, Schemas.userstreams)

        if (!entity || !profile || !userstreams) return null

        return {
            ...entity,
            profile: profile.payload.body,
            userstreams: userstreams.payload.body
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
        const association = await this.api.readAssociationWithOwner(id, owner)
        if (!association) return null

        const author = await this.getUser(association.author)
        if (!author) return null

        const target = deep ? (await this.getMessage(association.targetID, owner, false)) : null

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
                const replyBody = deep ? (await this.getMessage(association.payload.body.messageId, association.payload.body.messageAuthor, false)) : null
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
                const rerouteBody = deep ? (await this.getMessage(association.payload.body.messageId, association.payload.body.messageAuthor, false)) : null
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
        const message = await this.api.readMessageWithAuthor(id, authorID)
        if (!message) return null

        const author = await this.getUser(authorID)
        if (!author) return null

        const allAssociations: Association[] = deep ? (await Promise.all(
            message.associations.map(async (e) => {
                return await this.getAssociation(e.id, e.author, false)
            })
        )).filter((e: Association | null) => (e !== null)) as Association[] : []

        const favorites: A_Favorite[] =  allAssociations.filter((e) => e.schema === Schemas.like) as A_Favorite[]
        const reactions: A_Reaction[] = allAssociations.filter((e) => e.schema === Schemas.emojiAssociation) as A_Reaction[]
        const replies: A_Reply[] = allAssociations.filter((e) => e.schema === Schemas.replyAssociation) as A_Reply[]
        const reroutes: A_Reroute[] = allAssociations.filter((e) => e.schema === Schemas.rerouteAssociation) as A_Reroute[]

        const allstreams = (await Promise.all(
            message.streams.map(async (e) => await this.getStream(e))
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

                const replyTarget = await this.getMessage(message.payload.body.replyToMessageId, message.payload.body.replyToMessageAuthor)

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

                const rerouteTarget = await this.getMessage(message.payload.body.rerouteMessageId, message.payload.body.rerouteMessageAuthor)

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
        const authorInbox = target.author.userstreams.notificationStream
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
        const authorInbox = target.author.userstreams.notificationStream
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

}
