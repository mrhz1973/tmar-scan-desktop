// SPDX-License-Identifier: AGPL-3.0-only
// Public-safe noisy sheet; indexed PLY keeps the selection's vertex order.
export function noisySheet(n=48,step=.5) {
  const positions=[],indices=[]
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)positions.push((i-n/2)*step,(j-n/2)*step,.06*Math.sin(i*1.7)*Math.cos(j*1.9))
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i;indices.push(a,a+1,a+n+2,a,a+n+2,a+n+1)}
  const head=Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${positions.length/3}\nproperty float x\nproperty float y\nproperty float z\nelement face ${indices.length/3}\nproperty list uchar uint vertex_indices\nend_header\n`)
  const bytes=Buffer.alloc(head.length+positions.length*4+indices.length/3*13);head.copy(bytes);let offset=head.length
  for(const x of positions){bytes.writeFloatLE(x,offset);offset+=4}
  for(let t=0;t<indices.length;t+=3){bytes[offset++]=3;for(let k=0;k<3;k++){bytes.writeUInt32LE(indices[t+k],offset);offset+=4}}
  return {bytes,positions,indices}
}
