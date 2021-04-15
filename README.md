# NAT Punchthrough Server

This is a customized NAT punchthrough server based off [SLikeNet](https://github.com/SLikeSoft/SLikeNet) for customized clients.

## Setup

You'll need an internet-connected server that can run Docker containers.
Google Cloud Compute Engine has a free tier that works well.

1. Grab the Docker container `docker pull mtxing/cugl-nat-punchthrough:latest`
2. Run it and publish the exposed port (either with `docker run -P mtxing/cugl-nat-punchthrough:latest` to get a randomly assigned port or use `docker run -p 61111:61111/udp mtxing/cugl-nat-punchthrough:latest` to use port 61111 like the demo server does)
3. Make sure your VM's firewall settings allow udp traffic through whichever port you're using
