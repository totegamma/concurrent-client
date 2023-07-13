import { Api } from './api'

import { Schemas } from '../schemas'
import { Like } from '../schemas/like'
import { EmojiAssociation } from '../schemas/emojiAssociation'
import { RerouteMessage } from '../schemas/rerouteMessage'
import { RerouteAssociation } from '../schemas/rerouteAssociation'
import { Userstreams } from '../schemas/userstreams'
import { CCID, Character } from '../model/core'
import { Message, Association, User, M_Current, M_Reroute, M_Reply, A_Favorite, A_Reply, A_Reroute, Stream } from '../model/wrapper'
import { Profile } from '../schemas/profile'
import { SimpleNote } from '../schemas/simpleNote'
import { Commonstream } from '../schemas/commonstream'

export class Client {
    api: Api
    ccid: CCID

    constructor(ccid: string, privatekey: string, host: string, client?: string) {
        this.ccid = ccid
        this.api = new Api(ccid, privatekey, host, client)
    }

    async getUser(id: string): Promise<User | null> {
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

    async getStream(id: string): Promise<Stream | null> {
        const stream = await this.api.readStream(id)
        if (!stream) return null
        return {
            id,
            ...stream.payload.body
        }
    }

    async getMessage(id: string, authorID: string): Promise<M_Current | M_Reroute | M_Reply | null> {
        const message = await this.api.readMessageWithAuthor(id, authorID)
        if (!message) return null

        const author = await this.getUser(authorID)
        if (!author) return null

        const favoriteAssociations = message.associations.filter((e) => e.schema === Schemas.like)
        const favorites: A_Favorite[] = (await Promise.all(
            favoriteAssociations.map(async (e) => {
                return {
                    id,
                    cdate: new Date(e.cdate),
                    ...e.payload.body,
                    author: await this.getUser(e.author)
                }
            })
        )).filter((e: any) => e.author)

        const reactionAssociations = message.associations.filter((e) => e.schema === Schemas.emojiAssociation)
        const reactions: EmojiAssociation[] = (await Promise.all(
            reactionAssociations.map(async (e) => {
                return {
                    id,
                    cdate: new Date(e.cdate),
                    ...e.payload.body,
                    author: await this.getUser(e.author)
                }
            })
        )).filter((e: any) => e.author)

        const replyAssociations = message.associations.filter((e) => e.schema === Schemas.replyAssociation)
        const replies: A_Reply[] = (await Promise.all(
            replyAssociations.map(async (e) => {
                return {
                    id,
                    cdate: new Date(e.cdate),
                    ...e.payload.body,
                    author: await this.getUser(e.author)
                }
            })
        )).filter((e: any) => e.author)

        const rerouteAssociations = message.associations.filter((e) => e.schema === Schemas.rerouteAssociation)
        const reroutes: A_Reroute[] = (await Promise.all(
            rerouteAssociations.map(async (e) => {
                return {
                    id,
                    cdate: new Date(e.cdate),
                    ...e.payload.body,
                    author: await this.getUser(e.author)
                }
            })
        )).filter((e: any) => e.author)

        const streams = await Promise.all(
            message.streams.map(async (e) => await this.getStream(e))
        )

        switch (message.schema) {
            case Schemas.simpleNote:
                return {
                    schema: message.schema,
                    cdate: message.cdate,
                    ...message.payload.body,
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
                    schema: message.schema,
                    cdate: message.cdate,
                    ...message.payload.body,
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
                    schema: message.schema,
                    cdate: message.cdate,
                    ...message.payload.body,
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

    async getUserHomeStreams(users: string[]): Promise<string[]> {
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

    async createCurrent(body: string, streams: string[]): Promise<Error | null> {
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
        const authorInbox = (await this.api.readCharacter(target.id, Schemas.userstreams))?.payload.body.notificationStream
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
        const authorInbox = (await this.api.readCharacter(target.author.ccaddr, Schemas.userstreams))?.payload.body.notificationStream
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

    async removeAssociation(target: Message, associationID: string) :Promise<void> {
        const { content } = await this.api.deleteAssociation(associationID, target.author.ccaddr)
        this.api.invalidateMessage(content.targetID)
    }

    async reroute(id: string, author: CCID, streams: string[], body?: string): Promise<void> {
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

    async deleteMessage(target: M_Current | M_Reply | M_Reroute): Promise<void> {
        return this.api.deleteMessage(target.id)
    }


    async getCommonStreams(domain: string): Promise<Stream[]> {
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

