import { TimelineItem } from '../model/core';
import { Api } from './api';

export interface Query {
    schema?: string,
    owner?: string,
    author?: string,
}

export class QueryTimelineReader {

    body: TimelineItem[] = [];
    onUpdate?: () => void;
    api: Api;
    timeline?: string;
    query: Query = {};
    batch: number = 16;

    constructor(api: Api) {
        this.api = api;
    }

    async init(id: string, query: Query, limit: number): Promise<boolean> {
        this.timeline = id;
        let hasMore = true;
        this.batch = limit;
        this.query = query;

        await this.api.queryTimeline(id, query, undefined, limit).then((items: TimelineItem[]) => {
            this.body = items;
            if (items.length < limit) {
                hasMore = false;
            }
            this.onUpdate?.();
        })

        return hasMore;
    }

    async readMore(): Promise<boolean> {
        if (!this.timeline) return false;
        const last = this.body[this.body.length - 1];
        const items = await this.api.queryTimeline(this.timeline, this.query, last.cdate, this.batch);

        const newdata = items.filter(item => !this.body.find(i => i.resourceID === item.resourceID));
        if (newdata.length === 0) return false
        this.body = this.body.concat(newdata);
        this.onUpdate?.();
        return true
    }

    async reload(): Promise<boolean> {
        if (!this.timeline) return false;
        return this.init(this.timeline, this.query, this.batch);
    }
}

