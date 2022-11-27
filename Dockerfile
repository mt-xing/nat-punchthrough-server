FROM gcc:10 AS cpp
COPY src /usr/src/punchthrough
WORKDIR /usr/src/punchthrough
RUN make

FROM node:16
COPY web /usr/web/punchthrough
WORKDIR /usr/web/punchthrough
RUN npm install
COPY --from=cpp /usr/src/punchthrough/output ./cpp

CMD ./cpp & node index.js
EXPOSE 8080 61111/udp