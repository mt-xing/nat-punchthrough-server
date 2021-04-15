FROM gcc:10
COPY src /usr/src/punchthrough
WORKDIR /usr/src/punchthrough
RUN make
CMD ["./output"]
EXPOSE 61111/udp
