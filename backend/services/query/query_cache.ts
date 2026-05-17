/**
 * Simple in-memory cache for recent query results
 * This allows users to change chart types without re-querying data
 */

interface CachedQuery {
    id: string;
    userId: string;
    channelId: string;
    sqlQuery: string;
    queryResults: any[];
    timestamp: number;
    question: string;
}

class QueryCacheService {
    private cache: Map<string, CachedQuery> = new Map();
    private readonly MAX_CACHE_SIZE = 50; // Keep last 50 queries
    private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

    /**
     * Store query results in cache
     */
    storeQuery(
        userId: string, 
        channelId: string, 
        sqlQuery: string, 
        queryResults: any[], 
        question: string
    ): string {
        const id = this.generateId();
        const cachedQuery: CachedQuery = {
            id,
            userId,
            channelId,
            sqlQuery,
            queryResults,
            timestamp: Date.now(),
            question
        };

        this.cache.set(id, cachedQuery);
        this.cleanup();
        
        return id;
    }

    /**
     * Get the most recent query for a user in a channel
     */
    getRecentQuery(userId: string, channelId: string): CachedQuery | null {
        const userQueries = Array.from(this.cache.values())
            .filter(query => 
                query.userId === userId && 
                query.channelId === channelId &&
                (Date.now() - query.timestamp) < this.CACHE_TTL
            )
            .sort((a, b) => b.timestamp - a.timestamp);

        return userQueries.length > 0 ? userQueries[0] : null;
    }

    /**
     * Get a specific query by ID
     */
    getQueryById(id: string): CachedQuery | null {
        const query = this.cache.get(id);
        if (query && (Date.now() - query.timestamp) < this.CACHE_TTL) {
            return query;
        }
        return null;
    }

    /**
     * Clear expired entries and limit cache size
     */
    private cleanup(): void {
        const now = Date.now();
        const entries = Array.from(this.cache.entries());
        
        // Remove expired entries
        entries.forEach(([id, query]) => {
            if (now - query.timestamp > this.CACHE_TTL) {
                this.cache.delete(id);
            }
        });

        // If still too many entries, remove oldest
        if (this.cache.size > this.MAX_CACHE_SIZE) {
            const sortedEntries = Array.from(this.cache.entries())
                .sort(([, a], [, b]) => a.timestamp - b.timestamp);
            
            const toRemove = sortedEntries.slice(0, this.cache.size - this.MAX_CACHE_SIZE);
            toRemove.forEach(([id]) => this.cache.delete(id));
        }
    }

    /**
     * Generate a unique ID for cached queries
     */
    private generateId(): string {
        return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; maxSize: number; ttl: number } {
        return {
            size: this.cache.size,
            maxSize: this.MAX_CACHE_SIZE,
            ttl: this.CACHE_TTL
        };
    }
}

export const queryCacheService = new QueryCacheService();
