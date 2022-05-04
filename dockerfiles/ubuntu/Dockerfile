# This image is the base image that all other broker clients are built on top of.
# The following image is reachable through the snyk/ubuntu:latest image in DockerHub.
# Note that there's no need to build it; All broker client Dockerfiles use the snyk/ubuntu:latest.

FROM registry.access.redhat.com/ubi8/nodejs-16

USER root
RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --shell /bin/bash --create-home node \
  && yum update -y && yum upgrade -y

USER node
