PVObject_=pvModule
  Version=7.2.4
  Flags=$00100443

  PVObject_Commercial=pvCommercial
    Flags=$0041
    Manufacturer=Fabricante Teste
    Model=FT-555M-72
    DataSource=Fabricante Teste
    YearBeg=2021
    Width=1.134
    Height=2.278
    Depth=0.030
    Weight=32.800
    NPieces=100
    PriceDate=05/08/21 14:52
  End of PVObject pvCommercial

  Technol=mtSiMono
  NCelS=72
  NCelP=2
  NDiode=3
  SubModuleLayout=slTwinHalfCells
  FrontSurface=fsARCoating
  GRef=1000
  TRef=25.0
  PNom=555.0
  PNomTolLow=0.00
  PNomTolUp=3.00
  Isc=14.040
  Voc=49.95
  Imp=13.190
  Vmp=42.10
  muISC=6.50
  muVocSpec=145.5
  muPmpReq=-0.350
  RShunt=600
  Rp_0=2500
  Rp_Exp=5.50
  RSerie=0.200
  Gamma=0.978
  muGamma=-0.0005
  VMaxIEC=1500
  VMaxUL=1500
  Absorb=0.90
  ARev=3.200
  BRev=-11998.800
  RDiode=0.010
  VRevDiode=-0.70
  AirMassRef=1.500
  CellArea=165.6
  SandiaAMCorr=50.000
  RelEffic800=-0.13
  RelEffic600=0.19
  RelEffic400=-0.78
  RelEffic200=-2.33

  PVObject_IAM=pvIAM
    Flags=$00
    IAMMode=UserProfile
    IAMProfile=TCubicProfile
      NPtsMax=9
      NPtsEff=9
      LastCompile=$B18D
      Mode=3
      Point_1=0.0,1.00000
      Point_2=50.0,0.99900
      Point_3=60.0,0.99400
      Point_4=65.0,0.98100
      Point_5=70.0,0.96300
      Point_6=75.0,0.92900
      Point_7=80.0,0.85400
      Point_8=85.0,0.69500
      Point_9=90.0,0.00000
    End of TCubicProfile
  End of PVObject pvIAM

  OperPoints, list of=5 tOperPoint
    Point_1=False,800,25.0,-0.13,0.00,0.000,0.000,0.00
    Point_2=False,600,25.0,0.19,0.00,0.000,0.000,0.00
    Point_3=False,400,25.0,-0.78,0.00,0.000,0.000,0.00
    Point_4=False,200,25.0,-2.33,0.00,0.000,0.000,0.00
    Point_5=False,100,25.0,-4.57,0.00,0.000,0.000,0.00
  End of List OperPoints
End of PVObject pvModule
