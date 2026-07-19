// URP lit shader that tints ONLY the scarf region of an agent, using a
// black/white mask (white = scarf). Per-agent scarf color is set from C#
// (AgentAvatar) via a MaterialPropertyBlock on _ScarfColor, so all agents can
// share ONE material. Emission (the "speaking" pulse) can follow the scarf too.
Shader "Wih/AgentScarf"
{
    Properties
    {
        _BaseMap        ("Albedo", 2D) = "white" {}
        _BaseColor      ("Base Color", Color) = (1,1,1,1)
        _ScarfMask      ("Scarf Mask (R, white = scarf)", 2D) = "black" {}
        _ScarfColor     ("Scarf Color", Color) = (1,1,1,1)
        _ScarfStrength  ("Scarf Tint Strength", Range(0,1)) = 1
        _Smoothness     ("Smoothness", Range(0,1)) = 0.25
        _Metallic       ("Metallic", Range(0,1)) = 0
        [HDR]_EmissionColor ("Emission", Color) = (0,0,0,0)
        _EmissionFollowsScarf ("Emission Follows Scarf", Range(0,1)) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile _ LIGHTMAP_ON
            #pragma multi_compile _ DIRLIGHTMAP_COMBINED
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _ScarfMask_ST;
                half4  _BaseColor;
                half4  _ScarfColor;
                half   _ScarfStrength;
                half   _Smoothness;
                half   _Metallic;
                half4  _EmissionColor;
                half   _EmissionFollowsScarf;
            CBUFFER_END

            TEXTURE2D(_BaseMap);   SAMPLER(sampler_BaseMap);
            TEXTURE2D(_ScarfMask); SAMPLER(sampler_ScarfMask);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
                float2 lightmapUV : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv          : TEXCOORD0;
                float3 normalWS    : TEXCOORD1;
                float3 positionWS  : TEXCOORD2;
                DECLARE_LIGHTMAP_OR_SH(lightmapUV, vertexSH, 3);
                float  fogCoord    : TEXCOORD4;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT = (Varyings)0;
                VertexPositionInputs p = GetVertexPositionInputs(IN.positionOS.xyz);
                VertexNormalInputs   n = GetVertexNormalInputs(IN.normalOS);
                OUT.positionHCS = p.positionCS;
                OUT.positionWS  = p.positionWS;
                OUT.normalWS    = n.normalWS;
                OUT.uv          = TRANSFORM_TEX(IN.uv, _BaseMap);
                OUTPUT_LIGHTMAP_UV(IN.lightmapUV, unity_LightmapST, OUT.lightmapUV);
                OUTPUT_SH(OUT.normalWS, OUT.vertexSH);
                OUT.fogCoord    = ComputeFogFactor(p.positionCS.z);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                half4 baseTex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, IN.uv);
                half3 albedo  = baseTex.rgb * _BaseColor.rgb;

                half mask = SAMPLE_TEXTURE2D(_ScarfMask, sampler_ScarfMask, IN.uv).r;
                half sc   = saturate(mask * _ScarfStrength);
                // Recolor the scarf region to _ScarfColor (desaturate then tint) so
                // ANY target colour shows, regardless of the base scarf colour.
                half luma = dot(albedo, half3(0.299h, 0.587h, 0.114h));
                half3 scarfCol = _ScarfColor.rgb * (0.45h + luma);
                albedo    = lerp(albedo, scarfCol, sc);

                InputData inputData = (InputData)0;
                inputData.positionWS               = IN.positionWS;
                inputData.normalWS                 = normalize(IN.normalWS);
                inputData.viewDirectionWS          = GetWorldSpaceNormalizeViewDir(IN.positionWS);
                inputData.shadowCoord              = TransformWorldToShadowCoord(IN.positionWS);
                inputData.fogCoord                 = IN.fogCoord;
                inputData.bakedGI                  = SAMPLE_GI(IN.lightmapUV, IN.vertexSH, inputData.normalWS);
                inputData.normalizedScreenSpaceUV  = GetNormalizedScreenSpaceUV(IN.positionHCS);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo     = albedo;
                surfaceData.metallic   = _Metallic;
                surfaceData.smoothness = _Smoothness;
                surfaceData.occlusion  = 1.0h;
                half emisMask          = lerp(1.0h, sc, _EmissionFollowsScarf);
                surfaceData.emission   = _EmissionColor.rgb * emisMask;
                surfaceData.alpha      = 1.0h;

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFog(color.rgb, inputData.fogCoord);
                return color;
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0

            HLSLPROGRAM
            #pragma vertex shadowVert
            #pragma fragment shadowFrag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            float3 _LightDirection;

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct V { float4 positionHCS : SV_POSITION; };

            V shadowVert(A IN)
            {
                V OUT;
                float3 posWS = TransformObjectToWorld(IN.positionOS.xyz);
                float3 nWS   = TransformObjectToWorldNormal(IN.normalOS);
                float4 pos   = TransformWorldToHClip(ApplyShadowBias(posWS, nWS, _LightDirection));
                #if UNITY_REVERSED_Z
                    pos.z = min(pos.z, UNITY_NEAR_CLIP_VALUE);
                #else
                    pos.z = max(pos.z, UNITY_NEAR_CLIP_VALUE);
                #endif
                OUT.positionHCS = pos;
                return OUT;
            }
            half4 shadowFrag(V IN) : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On ColorMask 0

            HLSLPROGRAM
            #pragma vertex depthVert
            #pragma fragment depthFrag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct A { float4 positionOS : POSITION; };
            struct V { float4 positionHCS : SV_POSITION; };

            V depthVert(A IN) { V OUT; OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz); return OUT; }
            half4 depthFrag(V IN) : SV_Target { return 0; }
            ENDHLSL
        }
    }
    FallBack "Universal Render Pipeline/Lit"
}
