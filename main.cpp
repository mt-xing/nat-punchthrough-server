/*
 *  Original work: Copyright (c) 2014, Oculus VR, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  RakNet License.txt file in the licenses directory of this source tree. An additional grant 
 *  of patent rights can be found in the RakNet Patents.txt file in the same directory.
 *
 *
 *  Modified work: Copyright (c) 2016-2018, SLikeSoft UG (haftungsbeschränkt)
 *
 *  This source code was modified by SLikeSoft. Modifications are licensed under the MIT-style
 *  license found in the license.txt file in the root directory of this source tree.
 */

#include "slikenet/peerinterface.h"
#include "slikenet/sleep.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits> // used for std::numeric_limits
#include "slikenet/Kbhit.h"
#include "slikenet/MessageIdentifiers.h"
#include "slikenet/BitStream.h"
#include "slikenet/sleep.h"
#include "slikenet/UDPProxyServer.h"
#include "slikenet/UDPProxyCoordinator.h"
#include "slikenet/NatPunchthroughServer.h"
#include "slikenet/NatTypeDetectionServer.h"
#include "slikenet/SocketLayer.h"
#include "slikenet/Getche.h"
#include "slikenet/Gets.h"
#include "CloudServerHelper.h"
#include "slikenet/CloudClient.h"
#include "slikenet/statistics.h"
#include "slikenet/RelayPlugin.h"
#include "slikenet/linux_adapter.h"
#include "slikenet/osx_adapter.h"

#define VERBOSE_LOGGING

using namespace SLNet;

enum FeatureSupport
{
	SUPPORTED,
	UNSUPPORTED,
	QUERY
};

static unsigned short DEFAULT_RAKPEER_PORT=61111;

#define NatTypeDetectionServerFramework_Supported QUERY
#define NatPunchthroughServerFramework_Supported SUPPORTED
#define RelayPlugin_Supported QUERY
#define UDPProxyCoordinatorFramework_Supported UNSUPPORTED
#define UDPProxyServerFramework_Supported UNSUPPORTED
#define CloudServerFramework_Supported QUERY

struct SampleFramework
{
	virtual const char * QueryName(void)=0;
	virtual const char * QueryRequirements(void)=0;
	virtual const char * QueryFunction(void)=0;
	virtual void Init(SLNet::RakPeerInterface *rakPeer)=0;
	virtual void ProcessPacket(SLNet::RakPeerInterface *rakPeer, Packet *packet)=0;
	virtual void Shutdown(SLNet::RakPeerInterface *rakPeer)=0;

	FeatureSupport isSupported;
};

struct NatPunchthroughServerFramework : public SampleFramework, public NatPunchthroughServerDebugInterface_Printf
{
	NatPunchthroughServerFramework() {isSupported=NatPunchthroughServerFramework_Supported; nps=0;}
	virtual const char * QueryName(void) {return "NatPunchthroughServerFramework";}
	virtual const char * QueryRequirements(void) {return "None";}
	virtual const char * QueryFunction(void) {return "Coordinates NATPunchthroughClient.";}
	virtual void Init(SLNet::RakPeerInterface *rakPeer)
	{
		if (isSupported==SUPPORTED)
		{
			nps = new NatPunchthroughServer;
			rakPeer->AttachPlugin(nps);
			#ifdef VERBOSE_LOGGING
				nps->SetDebugInterface(this);
			#endif
		}
	}
	virtual void ProcessPacket(SLNet::RakPeerInterface *rakPeer, Packet *packet)
	{
		// unused parameters
		(void)rakPeer;
		(void)packet;
	}
	virtual void Shutdown(SLNet::RakPeerInterface *rakPeer)
	{
		if (nps)
		{
			rakPeer->DetachPlugin(nps);
			delete nps;
		}
		nps=0;
	}

	NatPunchthroughServer *nps;
};

int main(int argc, char **argv)
{
	SLNet::RakPeerInterface *rakPeer= SLNet::RakPeerInterface::GetInstance();
	SystemAddress ipList[ MAXIMUM_NUMBER_OF_INTERNAL_IDS ];
	printf("IPs:\n");
	unsigned int i;
	for (i=0; i < MAXIMUM_NUMBER_OF_INTERNAL_IDS; i++) {
		ipList[i]=rakPeer->GetLocalIP(i);
		if (ipList[i]!=UNASSIGNED_SYSTEM_ADDRESS)
			printf("%i. %s\n", i+1, ipList[i].ToString(false));
		else
			break;
	}

	if (i == 0 && argc <= 3) {
		printf("Could not determine any local IP address.\n");
		return 3;
	}

	// If RakPeer is started on 2 IP addresses, NATPunchthroughServer supports port stride detection, improving success rate
	int sdLen=1;
	SLNet::SocketDescriptor sd[2];
	if (argc>1)
	{
		const int intPeerPort = atoi(argv[1]);
		if ((intPeerPort < 0) || (intPeerPort > std::numeric_limits<unsigned short>::max())) {
			printf("Specified peer port %d is outside valid bounds [0, %u]", intPeerPort, std::numeric_limits<unsigned short>::max());
			return 2;
		}
		DEFAULT_RAKPEER_PORT = static_cast<unsigned short>(intPeerPort);
	}

	// set the first IP address
	sd[0].port = DEFAULT_RAKPEER_PORT;
	// #med - improve the logic here to simplify the handling...
	if (argc > 2)
		strcpy_s(sd[0].hostAddress, argv[2]);

	// #high - improve determining the proper IP addresses
	//         - filter between IPv4/IPv6 and only use either of these
	//         - fallback to other IP addresses, if a given one failed to be bound
	// allow enforcing single IP address mode by specifying second/third argument to the same IP address
	if ((i >= 2 && argc <= 3) || (argc > 3)) {
		const char *ipAddress1 = (argc > 2) ? argv[2] : ipList[0].ToString(false);
		const char *ipAddress2 = (argc > 3) ? argv[3] : ipList[1].ToString(false);
		strcpy_s(sd[0].hostAddress, ipAddress1);
		sd[1].port = DEFAULT_RAKPEER_PORT+1;
		strcpy_s(sd[1].hostAddress, ipAddress2);
		printf("Dual IP address mode.\nFirst IP Address: '%s' (port: %u)\nSecond IP Address: '%s' (port: %u)\n", ipAddress1, sd[0].port, ipAddress2, sd[1].port);
		sdLen = 2;
	}
	else {
		printf("Single IP address mode.\nUsing port %i\n", sd[0].port);
	}

	const StartupResult success = rakPeer->Startup(8096, sd, sdLen);
	if (success != SLNet::RAKNET_STARTED)
	{
		printf("Failed to start rakPeer! Quitting - error code: %d\n", success);
		SLNet::RakPeerInterface::DestroyInstance(rakPeer);
		return 1;
	}
	rakPeer->SetTimeoutTime(5000, UNASSIGNED_SYSTEM_ADDRESS);
	printf("Started on %s\n\n", rakPeer->GetMyBoundAddress().ToString(true));

	rakPeer->SetMaximumIncomingConnections(8096);

	SampleFramework *sample = new NatPunchthroughServerFramework;
	printf("=======================\n"
		   "NAT Punchthrough Server\n"
		   "=======================\n");
	printf("Based on SLikeNet's NAT Punchthrough Server\n\n\n");

	if (sample->isSupported==SUPPORTED)
	{
		printf("Starting %s...\n", sample->QueryName());
		sample->Init(rakPeer);
		if (sample->isSupported!=SUPPORTED)
		{
			printf("Failed to start %s.", sample->QueryName());
			printf("\nCatastrophic failure.\nExiting now.\n");
			// We have a problem
			rakPeer->Shutdown(100);
			SLNet::RakPeerInterface::DestroyInstance(rakPeer);
			return 1;
		}
		else
			printf("Success.\n\n");
	}
	

	printf("\nEntering update loop. Press 'q' to quit.\n");

	SLNet::Packet *packet;
	bool quit=false;
	while (!quit)
	{
		for (packet=rakPeer->Receive(); packet; rakPeer->DeallocatePacket(packet), packet=rakPeer->Receive())
		{
			sample->ProcessPacket(rakPeer, packet);
			
		}

		if (_kbhit())
		{
			int ch = _getch();
			if (ch=='q')
			{
				quit=true;
			}
			else if (ch==' ')
			{
				RakNetStatistics rns;
				char message[2048];
				bool hasStatistics = rakPeer->GetStatistics(0, &rns);
				if (hasStatistics)
				{
					StatisticsToString(&rns, message, 2048, 2);
					printf("SYSTEM 0:\n%s\n", message);

					memset(&rns, 0, sizeof(RakNetStatistics));
					rakPeer->GetStatistics(UNASSIGNED_SYSTEM_ADDRESS, &rns);
					StatisticsToString(&rns, message, 2048, 2);
					printf("STAT SUM:\n%s\n", message);
				}
				else
				{
					printf("No system 0\n");
				}

				DataStructures::List<SystemAddress> addresses;
				DataStructures::List<RakNetGUID> guids;
				rakPeer->GetSystemList(addresses, guids);
				printf("%i systems connected\n", addresses.Size());
			}
		}
		RakSleep(30);
	}

	printf("Quitting.\n");
	sample->Shutdown(rakPeer);
	rakPeer->Shutdown(100);
	SLNet::RakPeerInterface::DestroyInstance(rakPeer);
	return 0;
}

