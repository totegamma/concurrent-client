import { Socket } from './socket';
import { TimelineEvent } from '../model/core';

type socketEvent = 'MessageCreated' | 'MessageDeleted' | 'AssociationCreated' | 'AssociationDeleted'

export class Subscription {

    socket: Socket;
    streams: string[] = [];
    fns: Record<socketEvent, Set<(event: TimelineEvent) => void>>

    on(type: socketEvent, fn: (event: TimelineEvent) => void) {
        if (this.fns[type]) {
            this.fns[type].add(fn)
        } else {
            this.fns[type] = new Set([fn])
        }
    }
    off(type: socketEvent, fn: (event: TimelineEvent) => void) {
        this.fns[type]?.delete(fn)
    }
    emit(type: socketEvent, event: TimelineEvent) {
        for (const fn of this.fns[type] || []) fn(event)
    }

    constructor(socket: Socket) {
        this.fns = {
            MessageCreated: new Set(),
            MessageDeleted: new Set(),
            AssociationCreated: new Set(),
            AssociationDeleted: new Set(),
        }
        this.socket = socket;
    }

    async listen(streams: string[]): Promise<void> {
        this.streams = streams
        await this.socket.waitOpen()
        this.socket.listen(streams, (event: TimelineEvent) => {
            switch (event.type + '.' + event.action) {
                case 'message.create':
                    this.emit('MessageCreated', event);
                    break;
                case 'message.delete':
                    this.emit('MessageDeleted', event);
                    break;
                case 'association.create':
                    this.emit('AssociationCreated', event);
                    break;
                case 'association.delete':
                    this.emit('AssociationDeleted', event);
                    break;
                default:
                    console.log('unknown event', event)
            }
        })
    }
}

