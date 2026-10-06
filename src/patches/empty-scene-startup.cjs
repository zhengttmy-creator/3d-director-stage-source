const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

module.exports=function patchEmptySceneStartup(factories) {
  const before='function ns(){let e=new Date().toISOString(),t=nn(iw(),{id:nt,name:"\\u6446\\u62CD 01",createdAt:e,updatedAt:e});return{version:3,coordinateSystem:"y-up",activeWorkspace:{kind:"staging",id:t.id},stagingWorkspaces:[t],performanceWorkspaces:[],sharedLibrary:{poses:[],cameras:[],captures:[]},exports:[]}}';
  let source=factories['53401'];
  assert.equal(source.split(before).length,2,'Empty startup anchor: new project constructor');
  source=source.replace(before,fs.readFileSync(path.join(__dirname,'empty-scene-startup-runtime.js'),'utf8')+
    '\nfunction ns(){return __localCreateEmptyDirectorProject()}');
  const performance='n=`performance-${crypto.randomUUID()}`,o=iw(),s=o.objects.find(e=>"environment"===e.kind)';
  assert.equal(source.split(performance).length,2,'Empty startup anchor: new performance workspace');
  source=source.replace(performance,
    'n=`performance-${crypto.randomUUID()}`,o=__localEmptyDirectorState(),s=o.objects.find(e=>"environment"===e.kind)');
  const replace=(label,before,after)=>{
    assert.equal(source.split(before).length,2,'Empty startup anchor: '+label);
    source=source.replace(before,after);
  };
  replace('freeze empty camera state','g=iS({...iw(),mode:"object",selectedObjectIds:[],lockedJointIds:[],jointTransforms:t.evaluatedFrame.jointTransforms',
    'g=iS({...iw(),...i.multiCamera?.cameras.length===0?{multiCamera:{schemaVersion:3,cameras:[],outputCameraId:""}}:{},mode:"object",selectedObjectIds:[],lockedJointIds:[],jointTransforms:t.evaluatedFrame.jointTransforms');
  replace('freeze retains explicit empty cameras','environment:k9(g.environment),sceneCamera:k9(g.sceneCamera),captures:[]}',
    'environment:k9(g.environment),sceneCamera:k9(g.sceneCamera),...g.multiCamera?.cameras.length===0?{multiCamera:k9(g.multiCamera)}:{},captures:[]}');
  replace('freeze camera-only change','return h&&k8(k6(h),k6(v))?',
    'return h&&(!v.multiCamera||h.multiCamera?.cameras.length===0)&&k8(k6(h),k6(v))?');
  factories['53401']=source;
};
