function __localEmptyDirectorState() {
  const state=iw();
  const sceneCamera={...state.sceneCamera,cameraHelperVisible:false,targetHelperVisible:false};
  return {...state,mode:'object',selectedObjectIds:[],lockedJointIds:[],jointTransforms:{},selectionGroups:[],
    // The environment record owns the grid and lighting, not a placed scene asset.
    objects:state.objects.filter(object=>object.kind==='environment'),
    poses:[],scenes:[],cameras:[],captures:[],sceneCamera,
    multiCamera:{schemaVersion:3,cameras:[],outputCameraId:''},
    timeline:{...ib(sceneCamera),clips:[],objectTracks:{},cameraCutTrack:{version:1,clips:[]}}};
}

function __localCreateEmptyDirectorProject() {
  const now=new Date().toISOString();
  const stage=nn(__localEmptyDirectorState(),{id:nt,name:'\u6446\u62cd 01',createdAt:now,updatedAt:now});
  return {version:3,coordinateSystem:'y-up',activeWorkspace:{kind:'staging',id:stage.id},
    stagingWorkspaces:[stage],performanceWorkspaces:[],sharedLibrary:{poses:[],cameras:[],captures:[]},exports:[]};
}
