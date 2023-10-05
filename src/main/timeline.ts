// import { Api } from './api';
import { Socket } from './socket';
import { StreamEvent, StreamItem } from '../model/core';

export class Timeline {

    body: StreamItem[] = [];
    onUpdate?: () => void;
    socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    async listen(streams: string[]): Promise<void> {
        return this.socket.listen(streams, (event: StreamEvent) => {
            switch (event.type + '.' + event.action) {
                case 'message.create':
                    this.body.unshift(event.item);
                    this.onUpdate?.();
                    break;
                case 'message.delete':
                    this.body = this.body.filter(m => m.objectID !== event.item.objectID);
                    this.onUpdate?.();
                    break;
                case 'association.create':
                    // TODO
                    this.onUpdate?.();
                    break;
                case 'association.delete':
                    // TODO
                    this.onUpdate?.();
                    break;
                default:
                    console.log('unknown event', event)
            }
        })
    }

    async readMore(): Promise<void> {
    }

}

