import { Socket, TimelineEvent } from './socket';
import { Association, TimelineItem } from '../model/core';
import { Api } from './api';
import { CCDocument } from '..';

export class TimelineReader {

    body: TimelineItem[] = [];
    onUpdate?: () => void;
    onRealtimeEvent?: (event: TimelineEvent) => void;
    socket?: Socket;
    api: Api;
    streams: string[] = [];

    constructor(api: Api, socket?: Socket) {
        this.api = api;
        this.socket = socket;
    }

    processEvent(event: TimelineEvent) {
        switch (event.document?.type) {
            case 'message': {
                if (this.body.find(m => m.resourceID === event.item.resourceID)) return;
                this.body.unshift(event.item);
                this.onUpdate?.();
                break;
            }
            case 'association': {
                if (!event.document) return;
                const document = event.document as CCDocument.Association<any>
                const target = this.body.find(m => m.resourceID === document.target);
                if (!target) return;
                target.lastUpdate = new Date();
                this.onUpdate?.();
                break;
            }
            case 'delete': {
                if (!event.document) return;
                const document = event.document as CCDocument.Delete
                switch (document.target[0]) {
                    case 'm':
                        this.body = this.body.filter(m => m.resourceID !== document.target);
                        this.onUpdate?.();
                        break;
                    case 'a':
                        if (!event.resource) return;
                        const resource = event.resource as Association<any>
                        const target = this.body.find(m => m.resourceID === resource.target);
                        if (!target) return;
                        target.lastUpdate = new Date();
                        this.onUpdate?.();
                        break;
                }
                break;
            }
            default:
                if (event.item.resourceID) {
                    switch (event.item.resourceID[0]) {
                        case 'm': {
                            if (this.body.find(m => m.resourceID === event.item.resourceID)) return;
                            this.body.unshift(event.item);
                            this.onUpdate?.();
                            break;
                        }
                    }
                }
        }

        this.onRealtimeEvent?.(event);
    }

    async listen(streams: string[]): Promise<boolean> {

        this.streams = streams;

        let hasMore = true;

        await this.api.getTimelineRecent(streams).then((items: TimelineItem[]) => {
            this.body = items;
            if (items.length < 16) {
                hasMore = false;
            }
            this.onUpdate?.();
        })

        this.socket?.listen(streams, this.processEvent.bind(this));
    
        return hasMore
    }

    async readMore(): Promise<boolean> {
        if (this.body.length === 0) return false
        const last = this.body[this.body.length - 1];
        const items = await this.api.getTimelineRanged(this.streams, {until: last.cdate});
        const newdata = items.filter(item => !this.body.find(i => i.resourceID === item.resourceID));
        if (newdata.length === 0) return false
        this.body = this.body.concat(newdata);
        this.onUpdate?.();
        return true
    }

    async reload(): Promise<boolean> {
        let hasMore = true;
        const items = await this.api.getTimelineRecent(this.streams);
        this.body = items;
        if (items.length < 16) {
            hasMore = false;
        }
        this.onUpdate?.();
        return hasMore
    }

    dispose() {
        this.socket?.unlisten(this.streams, this.processEvent);
        this.onUpdate = undefined;
        this.onRealtimeEvent = undefined;
    }
}

