// Authored floor templates. Each character is one 1×1 world cell (x = column, z = row).
//
// Legend
//   #  wall (cells with no walkable neighbour are not rendered)
//   .  corridor floor          _  apartment floor
//   N  maintenance nook (emergency lit)       P  player start (nook)
//   n  nook fixture on circuit A (emergency lit, tutorial repair)
//   L  exit landing (emergency lit)           E  exit door (solid)
//   o  open doorway            d  closed apartment door (solid, tenant door)
//   a b c  building fixture on circuit A / B / C (floor kind inferred from neighbours)
//   1 2 3  breaker switch for circuit A / B / C (emergency pad; panel mounts on adjacent wall)
//   S  creature spawn candidate               t  tenant porch candidate (next to a `d`)
//   Furniture (solid, apartment only): q sofa, r bed, k bookshelf, w table, v cabinet, p plant

export interface FloorTemplate {
  id: string;
  name: string;
  map: string[];
  /** Labels for doors (`o`, `d`) in reading order; empty string for unlabelled. */
  doorLabels: string[];
  exitLabel: string;
}

export const TEMPLATES: FloorTemplate[] = [
  {
    id: 'east-hall',
    name: 'East Hall',
    doorLabels: ['101', '102', '103', '107', '105', '', '106'],
    exitLabel: 'STAIRS',
    map: [
      '##############################',
      '#k_____#v_____k#k______#######',
      '#___a__#qq_b___#__b__ww#######',
      '#rr___p#______k#_______#######',
      '#rr____#p______#S_____p#######',
      '###o#######o#######o#####d####',
      '#NNNn..a.........b.......t.1##',
      '#1NNN.......a.........b....2##',
      '#2NPN####o##########o#####.3##',
      '#3NNN#k______v#vv________#..##',
      '######___a____#____c_____#c.##',
      '######qq______#__________#.td#',
      '######p______S#_________S#..##',
      '######rr______#__ww______#.c##',
      '######rr_____k#k_________#LL##',
      '##########################LL##',
      '##########################EE##',
      '##############################',
    ],
  },
  {
    id: 'ring',
    name: 'Courtyard Ring',
    doorLabels: ['201', '202', '203', '', '204', '206', '205'],
    exitLabel: 'STAIRS',
    map: [
      '##############################',
      '#k__qq___v#kk____v_#v___rr__k#',
      '#____a____#___a____#____rr_c_#',
      '#p________#__ww____#S_______p#',
      '#___ww____#p_______#_________#',
      '#######o######o#######o#######',
      '#####...a.........a....c1#####',
      '#####........a..........2#####',
      '#####a.################.3#####',
      '#1NNn..#v____________k#..LLL##',
      '#2NPN..#____b_____S___#c.LLLE#',
      '#3NNN..#kk__ww_______v#..LLL##',
      '#####.b#######o########..#####',
      '#####........b...........#####',
      '#####...b.....t...b....c.#####',
      '#########o####d#####o#########',
      '#k__qq______v###v____b_______#',
      '#____b______p###_________S__p#',
      '#rr_S____ww__###rr___________#',
      '#rr________kk###rr_______ww__#',
      '##############################',
    ],
  },
  {
    id: 'long-wing',
    name: 'Long Wing',
    doorLabels: ['', '', '108', '109', '101', '102', '103'],
    exitLabel: '104',
    map: [
      '##################################',
      '#vv____kk#kk_v#12#k___qq___k######',
      '#___a____#__c_#.3#____b_____######',
      '#S_______#____ob.oS________p######',
      '#__ww____#p___#..#__ww______######',
      '#_______p#____#.b#________kk######',
      '######o########..######d##########',
      '#1NNn..a.........b.....t...c..LLE#',
      '#2NPN.......a........b........LLE#',
      '#3NNN###o#########o#######o#######',
      '#####k___a__v#v______k#k_____c_###',
      '#####qq______#___b____#________###',
      '#####______S_#_ww_____#__ww__S_###',
      '#####rr______#p_____rr#rr_____p###',
      '#####rr____kp#kk____rr#rr__kk__###',
      '##################################',
    ],
  },
];

export function getTemplate(id: string): FloorTemplate {
  const t = TEMPLATES.find((tpl) => tpl.id === id);
  if (!t) throw new Error(`Unknown template ${id}`);
  return t;
}
