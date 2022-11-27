# NAT Punchthrough Server

This is a customized NAT punchthrough server based off [SLikeNet](https://github.com/SLikeSoft/SLikeNet) for [CUGL networked clients](https://github.com/mt-xing/cugl-networking-extension).

## Setup

You'll need an internet-connected server that can run Docker containers.
Google Cloud Compute Engine has a free tier that works well.

1. Grab the Docker container `docker pull mtxing/cugl-nat-punchthrough:latest`
2. Run it and publish the exposed port (either with `docker run -P mtxing/cugl-nat-punchthrough:latest` to get a randomly assigned port or use `docker run -p 61111:61111/udp -p 8080:8080 mtxing/cugl-nat-punchthrough:latest` to use ports 61111 and 8080 like the demo server does)
3. Make sure your VM's firewall settings allow udp traffic through whichever port you're using
