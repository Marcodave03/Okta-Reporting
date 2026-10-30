docker rm -f dd-agent

$env:DD_API_KEY = "6dd3613d840026bfb95029f3e997c212"

docker run -d --name dd-agent `
  --restart unless-stopped `
  --cgroupns host `
  --pid host `
  -e "DD_API_KEY=$env:DD_API_KEY" `
  -e "DD_SITE=datadoghq.com" `
  -e "DD_ENV=dev" `
  -e "DD_DOGSTATSD_NON_LOCAL_TRAFFIC=true" `
  -v "/var/run/docker.sock:/var/run/docker.sock:ro" `
  -v "/proc/:/host/proc/:ro" `
  -v "/sys/fs/cgroup/:/host/sys/fs/cgroup:ro" `
  -v "/var/lib/docker/containers:/var/lib/docker/containers:ro" `
  registry.datadoghq.com/agent:7