# NAT Punchthrough Server

This is a customized NAT punchthrough server based off [SLikeNet](https://github.com/SLikeSoft/SLikeNet) for customized clients.

## Setup

You'll need an internet-connected Linux server. Google Cloud Compute Engine has a free tier that works well.

1. Git clone this repo onto your server
2. Run `make`
3. Run `./output` to start the server interactively. To leave the server running, use `nohup`, a la `nohup ./output &`
4. If you want to kill and restart the server, you'll need to kill the process manually (Google how to find and kill a Linux process if unfamiliar)
