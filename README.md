# ThreeTwo Metadata Service

This [moleculer-based](https://github.com/moleculerjs/moleculer-web) microservice provides metadata endpoints for [ThreeTwo!](https://github.com/rishighan/threetwo), fetching comic book information from:

- **ComicVine** - Comprehensive comic database
- **Metron** - Community-driven comic metadata API
- **League of Comic Geeks** - Weekly pull list data

## Features

- **GraphQL API** - Unified query interface for all metadata sources
- **Volume-based Search** - Intelligent matching with scoring algorithms
- **Rate Limiting** - Respects API rate limits with automatic throttling
- **Caching** - Conditional requests with `If-Modified-Since` support
- **Socket.IO Events** - Real-time progress updates during searches

## Environment Variables

### Required

```bash
# ComicVine API
COMICVINE_API_KEY=your_comicvine_api_key

# Metron API (https://metron.cloud/accounts/signup/)
METRON_USERNAME=your_metron_username
METRON_PASSWORD=your_metron_password
```

### Optional

```bash
# Service Configuration
PORT=3080
NODE_ENV=development
```

## Local Development

1. Clone this repo
2. Copy environment variables:
   ```bash
   cp docker-compose.env.example docker-compose.env
   # Edit docker-compose.env with your API credentials
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the service:
   ```bash
   npm run dev
   ```
5. Access the API:
   - REST: `http://localhost:3080/api/`
   - GraphQL: `http://localhost:3080/graphql`

## Docker Instructions

1. Build the image:
   ```bash
   docker build . -t frishi/threetwo-metadata-service
   ```
2. Run with environment variables:
   ```bash
   docker run -it \
     -e COMICVINE_API_KEY=your_key \
     -e METRON_USERNAME=your_username \
     -e METRON_PASSWORD=your_password \
     -p 3080:3080 \
     frishi/threetwo-metadata-service
   ```

## API Endpoints

### REST Endpoints

#### ComicVine
- `GET /api/comicvine/search` - Search ComicVine
- `POST /api/comicvine/volumeBasedSearch` - Volume-based search with scoring
- `POST /api/comicvine/getVolumes` - Get volume details
- `POST /api/comicvine/getResource` - Get generic resource

#### Metron (v1)
- `GET /api/v1/metron/health` - Health check and rate limit status
- `GET /api/v1/metron/series/search?name=Batman` - Search series
- `GET /api/v1/metron/series/:id` - Get series details
- `GET /api/v1/metron/issue/search` - Search issues with filters
- `GET /api/v1/metron/issue/:id` - Get issue details
- `POST /api/v1/metron/volumeBasedSearch` - Volume-based search with scoring

### GraphQL Queries

```graphql
# Check Metron service status
query {
  metronHealth {
    status
    configured
    rateLimit {
      burstRemaining
      sustainedRemaining
    }
  }
}

# Search for series
query SearchSeries($name: String!) {
  searchMetronSeries(input: { name: $name }) {
    count
    results {
      id
      name
      year_began
      publisher {
        name
      }
    }
  }
}

# Volume-based search (like ComicVine)
query VolumeSearch($name: String!, $issueNumber: String, $year: String) {
  metronVolumeBasedSearch(input: {
    scorerConfiguration: {
      searchParams: {
        name: $name
        issueNumber: $issueNumber
        year: $year
      }
    }
  }) {
    finalMatches {
      score
      issue {
        id
        issueNumber
        title
        cover_date
      }
      series {
        name
        publisher {
          name
        }
      }
    }
  }
}
```

### GraphQL Mutations

```graphql
# Apply Metron metadata to a comic
mutation ApplyMetadata($comicId: ID!, $issueId: Int!, $seriesId: Int!) {
  applyMetronMetadata(input: {
    comicObjectId: $comicId
    metronIssueId: $issueId
    metronSeriesId: $seriesId
  }) {
    success
    message
    updatedAt
  }
}
```

## Socket.IO Events

The service broadcasts real-time progress updates during searches:

### ComicVine Events
- **Event:** `CV_SCRAPING_STATUS`
- **Stages:** `fetching_volumes`, `ranking_volumes`, `searching_issues`, `fetching_volume_details`, `scoring_matches`, `complete`, `error`

### Metron Events
- **Event:** `METRON_SCRAPING_STATUS`
- **Stages:** `fetching_series`, `ranking_series`, `searching_issues`, `fetching_details`, `scoring_matches`, `complete`, `error`

## Architecture

```
threetwo-metadata-service/
├── services/
│   ├── api.service.ts        # REST API gateway
│   ├── gateway.service.ts    # GraphQL gateway
│   ├── comicvine.service.ts  # ComicVine API integration
│   └── metron.service.ts     # Metron API integration
├── models/graphql/
│   ├── typedef.ts            # GraphQL type definitions
│   └── resolvers.ts          # GraphQL resolvers
├── types/
│   └── metron.types.ts       # TypeScript interfaces
└── utils/
    ├── searchmatchscorer.utils.ts  # ComicVine scoring
    └── metron-scorer.utils.ts      # Metron scoring
```

## Metron API Notes

- **Authentication:** HTTP Basic Auth
- **Rate Limiting:** 
  - Burst: Check `X-RateLimit-Burst-*` headers
  - Sustained: Check `X-RateLimit-Sustained-*` headers
- **Conditional Requests:** Uses `If-Modified-Since` / `Last-Modified` for caching
- **Documentation:** https://metron.cloud/wiki/api/api-documentation/

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run linting: `npm run lint`
4. Submit a pull request

## License

MIT
