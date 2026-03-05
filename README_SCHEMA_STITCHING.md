# GraphQL Schema Stitching - Unified Gateway

This service now implements **GraphQL Schema Stitching** to combine multiple GraphQL schemas into a single unified endpoint.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Application                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Single GraphQL Endpoint
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          API Gateway (port 3080)                             │
│          /graphql endpoint                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Moleculer RPC
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          Gateway Service (Schema Stitching)                  │
│          - Combines local + remote schemas                   │
│          - Routes queries to appropriate service             │
└────────┬────────────────────────────────────┬───────────────┘
         │                                    │
         │ Local Schema                       │ Remote Schema
         ▼                                    ▼
┌────────────────────┐              ┌────────────────────────┐
│  Local Services    │              │  Remote GraphQL Server │
│  - ComicVine       │              │  (port 3000)           │
│  - Metron          │              │  - Core Service        │
│  - Metadata        │              │  - Other queries       │
└────────────────────┘              └────────────────────────┘
```

## What is Schema Stitching?

Schema stitching combines multiple GraphQL schemas into a single unified schema. This allows you to:

1. **Query multiple services** through a single endpoint
2. **Combine data** from different sources in one request
3. **Maintain service independence** while providing a unified API
4. **Gradually migrate** services without breaking existing clients

## Configuration

### Environment Variables

Set the remote GraphQL server URL:

```bash
export REMOTE_GRAPHQL_URL="http://localhost:3000/graphql"
```

If not set, it defaults to `http://localhost:3000/graphql`.

### Service Files

- **[`services/gateway.service.ts`](services/gateway.service.ts)** - Gateway service with schema stitching logic
- **[`services/api.service.ts`](services/api.service.ts)** - API gateway routing to the gateway service
- **[`services/graphql.service.ts`](services/graphql.service.ts)** - Original local GraphQL service (still available)

## How It Works

### 1. Schema Introspection

On startup, the gateway service:
1. Introspects the remote GraphQL server at port 3000
2. Builds a client schema from the introspection result
3. Creates a local executable schema from the metadata service
4. Stitches both schemas together

### 2. Query Routing

When a query is received:
1. The gateway analyzes the query
2. Routes local queries (ComicVine, Metron) to local resolvers
3. Routes remote queries to the remote GraphQL server
4. Combines results if the query spans both schemas

### 3. Fallback Behavior

If the remote server is unavailable:
- The gateway starts with **local schema only**
- Logs a warning about remote unavailability
- Continues to serve local queries normally
- Remote queries will fail gracefully

## Usage

### Starting the Service

```bash
npm run dev
```

The unified GraphQL endpoint will be available at: `http://localhost:3080/graphql`

### Example: Local Query (Metadata Service)

```graphql
query SearchComicVine {
  searchComicVine(input: { 
    query: "Batman", 
    resources: "volume", 
    limit: 5 
  }) {
    number_of_total_results
    results {
      id
      name
      start_year
    }
  }
}
```

### Example: Remote Query (Core Service on port 3000)

Assuming your remote server has queries like `getUser`, `getComics`, etc.:

```graphql
query GetUser {
  getUser(id: "123") {
    id
    username
    email
  }
}
```

### Example: Combined Query (Both Services)

```graphql
query CombinedQuery {
  # Local metadata service
  searchComicVine(input: { 
    query: "Batman", 
    resources: "volume", 
    limit: 3 
  }) {
    results {
      id
      name
    }
  }
  
  # Remote core service
  getUser(id: "123") {
    id
    username
  }
}
```

## Benefits

### 1. Single Endpoint
- Clients only need to know about one GraphQL endpoint
- Simplifies frontend configuration
- Easier to manage authentication/authorization

### 2. Flexible Queries
- Query data from multiple services in one request
- Reduce network round trips
- Better performance for complex data requirements

### 3. Service Independence
- Each service maintains its own schema
- Services can be developed and deployed independently
- No tight coupling between services

### 4. Gradual Migration
- Add new services without breaking existing clients
- Migrate queries between services transparently
- Maintain backward compatibility

## Monitoring & Debugging

### Logs

The gateway service logs important events:

```
[GATEWAY] Initializing Apollo Gateway with Schema Stitching...
[GATEWAY] Attempting to introspect remote schema at http://localhost:3000/graphql
[GATEWAY] Successfully introspected remote schema
[GATEWAY] Stitching local and remote schemas together...
[GATEWAY] Schema stitching completed successfully
[GATEWAY] Apollo Gateway Server started successfully
```

### Introspection

Query the stitched schema:

```graphql
query IntrospectionQuery {
  __schema {
    queryType {
      name
      fields {
        name
        description
      }
    }
  }
}
```

### Health Check

Check gateway status:

```graphql
query GetGatewayInfo {
  __typename
}
```

## Troubleshooting

### Remote Server Unavailable

**Symptom**: Warning logs about remote schema introspection failure

**Solution**: 
1. Ensure the remote server is running on port 3000
2. Check the `REMOTE_GRAPHQL_URL` environment variable
3. Verify network connectivity
4. The gateway will continue with local schema only

### Query Routing Issues

**Symptom**: Queries to remote service fail or return null

**Solution**:
1. Check that the remote server is responding
2. Verify the query syntax matches the remote schema
3. Use introspection to see available fields
4. Check gateway logs for routing errors

### Type Conflicts

**Symptom**: Errors about duplicate types or conflicting definitions

**Solution**:
1. Ensure type names are unique across schemas
2. Use schema transformation if needed
3. Consider renaming conflicting types in one schema
4. Check the `mergeTypes` configuration in [`gateway.service.ts`](services/gateway.service.ts)

## Advanced Configuration

### Custom Executors

Modify the executor in [`gateway.service.ts`](services/gateway.service.ts:95) to add:
- Authentication headers
- Request logging
- Error handling
- Caching

### Schema Transformations

Use `@graphql-tools/wrap` to transform schemas:
- Rename types
- Filter fields
- Add custom directives
- Modify field arguments

### Performance Optimization

Consider implementing:
- **DataLoader** for batching requests
- **Response caching** at the gateway level
- **Query complexity analysis** to prevent expensive queries
- **Rate limiting** per client or query type

## Migration from Separate Endpoints

### Before (Separate Endpoints)

```typescript
// Frontend code
const metadataClient = new ApolloClient({
  uri: 'http://localhost:3080/graphql'
});

const coreClient = new ApolloClient({
  uri: 'http://localhost:3000/graphql'
});
```

### After (Unified Gateway)

```typescript
// Frontend code
const client = new ApolloClient({
  uri: 'http://localhost:3080/graphql'  // Single endpoint!
});
```

## Comparison with Apollo Federation

| Feature | Schema Stitching | Apollo Federation |
|---------|------------------|-------------------|
| Setup Complexity | Moderate | Higher |
| Service Independence | Good | Excellent |
| Type Merging | Manual | Automatic |
| Best For | Existing services | New microservices |
| Learning Curve | Lower | Higher |

## Related Documentation

- [GraphQL API Documentation](README_GRAPHQL.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Main README](README.md)

## Support

For issues or questions:
1. Check the gateway service logs
2. Verify both servers are running
3. Test each service independently
4. Review the schema stitching configuration

## Future Enhancements

- [ ] Add authentication/authorization at gateway level
- [ ] Implement DataLoader for batching
- [ ] Add response caching
- [ ] Implement query complexity analysis
- [ ] Add rate limiting
- [ ] Support for GraphQL subscriptions
- [ ] Schema transformation utilities
- [ ] Automated schema versioning
