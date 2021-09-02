# comicvine-service

This microservice houses [comicvine](http://comicvine.gamespot.com) related endpoints that are used 
to fetch metadata for various reasons on [ThreeTwo!](https://github.com/rishighan/threetwo).

## Local Development

1. Clone this repo
2. Run `npm i`
3. You should see the service spin up and a list of all the endpoints in the terminal
4. The service can be accessed through `http://localhost:3080/api/comicvine/*`
## Docker Instructions

1. Build the image using `docker build . -t frishi/threetwo-import-service`. Give it a hot minute.
2. Run it using `docker run -it frishi/threetwo-import-service`