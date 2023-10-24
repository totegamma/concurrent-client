import { Socket } from './socket';
import { Association, Message, StreamEvent, StreamItem } from '../model/core';
import { Api } from './api';

export class Timeline {

    body: StreamItem[] = [];
    onUpdate?: () => void;
    onRealtimeEvent?: (event: StreamEvent) => void;
    socket: Socket;
    api: Api;
    streams: string[] = [];

    constructor(api: Api, socket: Socket) {
        this.api = api;
        this.socket = socket;
    }

    processEvent(event: StreamEvent) {
        switch (event.type + '.' + event.action) {
            case 'message.create':
                this.body.unshift(event.item);
                this.onUpdate?.();
                break;
            case 'message.delete': {
                const body = event.body as Message<any>
                this.body = this.body.filter(m => m.objectID !== body.id);
                this.onUpdate?.();
                break;
            }
            case 'association.create':
            case 'association.delete':
                if (!event.body) return;
                const body = event.body as Association<any>
                const target = this.body.find(m => m.objectID === body.targetID);
                if (!target) return;
                target.lastUpdate = new Date();
                this.onUpdate?.();
                break;
            default:
                console.log('unknown event', event)
        }
        this.onRealtimeEvent?.(event);
    }

    async listen(streams: string[]): Promise<boolean> {

        this.streams = streams;

        let hasMore = true;

        console.log('listen!', streams)

        await this.api.readStreamRecent(streams).then((items: StreamItem[]) => {
            this.body = items;
            if (items.length < 16) {
                hasMore = false;
            }
            this.onUpdate?.();
        })

        this.socket.listen(streams, this.processEvent.bind(this));
    
        return hasMore
    }

    async readMore(): Promise<boolean> {
        const last = this.body[this.body.length - 1];
        const items = await this.api.readStreamRanged(this.streams, {until: last.cdate});
        const newdata = items.filter(item => !this.body.find(i => i.objectID === item.objectID));
        if (newdata.length === 0) return false
        this.body = this.body.concat(newdata);
        this.onUpdate?.();
        return true
    }

    async reload(): Promise<boolean> {
        let hasMore = true;
        const items = await this.api.readStreamRecent(this.streams);
        this.body = items;
        if (items.length < 16) {
            hasMore = false;
        }
        this.onUpdate?.();
        return hasMore
    }

    dispose() {
        this.socket.unlisten(this.streams, this.processEvent);
        this.onUpdate = undefined;
        this.onRealtimeEvent = undefined;
    }
}

